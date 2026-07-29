import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { notifyAdmins } from '@/lib/telegram'
import { liveOrders, orderAmount } from '@/lib/liveOrders'

export const runtime = 'nodejs'
export const maxDuration = 60

// Утренний дайджест владельцу (07:00 МСК): деньги + цех + вчерашняя активность.
// Собирает дебиторку и кассовый прогноз той же логикой, что /cfo/receivables и /cfo/cashflow.

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

function parseNotes(raw: unknown): Record<string, unknown> {
  if (!raw) return {}
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw
    return typeof obj === 'object' && obj !== null ? (obj as Record<string, unknown>) : {}
  } catch { return {} }
}

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'

export async function GET(req: Request) {
  // CRON_FAIL_GUARD: падение крона раньше было тихим 500 — теперь пинг владельцу
  try {
    const auth = req.headers.get('authorization')
    if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    const sb = db()
    const now = new Date()
    const today = new Date(now); today.setHours(0, 0, 0, 0)
    const in7d = new Date(today.getTime() + 7 * 86400000)

    // Дебиторка — только живые заказы и постранично: архивные дубли импорта дают
    // владельцу фиктивный долг, а потолок PostgREST в 1000 строк прятал реальный.
    type OrderRow = { id: number; custom_number: string | null; client_name: string | null; total_sale_inc_vat: number | null; total_after_discount: number | null; created_at: string; notes: unknown }
    const orders: OrderRow[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await liveOrders(sb, 'id, custom_number, client_name, total_sale_inc_vat, total_after_discount, created_at, notes')
        .order('created_at', { ascending: false }).range(from, from + 999)
      if (error || !data?.length) break
      orders.push(...(data as unknown as OrderRow[]))
      if (data.length < 1000) break
    }

    const [{ data: fp }, { data: pp }, { data: tasks }, { data: calcsY }] = await Promise.all([
      sb.from('finplan_models').select('unit,data'),
      sb.from('planned_payments').select('kind, amount, due_date').eq('status', 'planned'),
      sb.from('production_tasks').select('status'),
      sb.from('calculations').select('id, created_at')
        .gte('created_at', new Date(today.getTime() - 86400000).toISOString())
        .lt('created_at', today.toISOString()),
    ])

    // ── Дебиторка B2B ──
    type Debtor = { label: string; debt: number; days: number }
    const debtors: Debtor[] = []
    for (const o of orders) {
      const n = parseNotes(o.notes)
      const st = (n.stages ?? {}) as Record<string, string>
      if (!['confirmed', 'agreed', 'sent'].includes(String(n.status ?? ''))) continue
      if (!st.invoice_sent || st.invoice_paid || n.payment_status === 'paid') continue
      const total = orderAmount(o)
      const debt = Math.max(0, total - (Number(n.prepayment_amount) || 0))
      if (debt <= 0) continue
      const days = Math.floor((now.getTime() - new Date(st.invoice_sent).getTime()) / 86400000)
      debtors.push({ label: `№${o.custom_number || o.id} ${o.client_name || ''}`.trim(), debt, days })
    }
    debtors.sort((a, b) => b.debt - a.debt)
    const debtSum = debtors.reduce((s, d) => s + d.debt, 0)

    // ── Кассовый прогноз на 7 дней ──
    let cash = 0, fixedMonthly = 0
    for (const row of fp ?? []) {
      if (row.unit === 'total' && row.data?.cashBalance != null) cash = Number(row.data.cashBalance) || 0
      if (row.unit === 'mglass' || row.unit === 'production') {
        fixedMonthly += ((row.data?.fixed ?? []) as { amount?: number }[])
          .reduce((s, f) => s + (Number(f.amount) || 0), 0)
      }
    }
    // приходы: счета, ожидаемые в окне (дата счёта + 14 дн; просроченные — считаем в окне)
    let inflow7 = 0
    for (const o of orders) {
      const n = parseNotes(o.notes)
      const st = (n.stages ?? {}) as Record<string, string>
      if (!['confirmed', 'agreed', 'sent'].includes(String(n.status ?? ''))) continue
      if (!st.invoice_sent || st.invoice_paid || n.payment_status === 'paid') continue
      const total = orderAmount(o)
      const debt = Math.max(0, total - (Number(n.prepayment_amount) || 0))
      if (debt <= 0) continue
      const expect = new Date(new Date(st.invoice_sent).getTime() + 14 * 86400000)
      if (expect <= in7d) inflow7 += debt
    }
    // постоянные, если 1-е число попадает в окно
    let outflow7 = 0
    const firstNext = new Date(today.getFullYear(), today.getMonth() + (today.getDate() === 1 ? 0 : 1), 1)
    if (firstNext < in7d) outflow7 += fixedMonthly
    for (const p of pp ?? []) {
      const due = new Date(p.due_date)
      if (due < in7d) {
        if (p.kind === 'out') outflow7 += Number(p.amount) || 0
        else inflow7 += Number(p.amount) || 0
      }
    }
    const cash7 = cash + inflow7 - outflow7

    // ── Цех ──
    const tq = (tasks ?? []).filter(t => t.status === 'queued').length
    const tp = (tasks ?? []).filter(t => t.status === 'in_progress').length
    const tpr = (tasks ?? []).filter(t => t.status === 'problem').length

    // ── Сообщение ──
    const lines: string[] = []
    lines.push(`☀️ <b>Доброе утро! Дайджест M-Glass</b>`)
    lines.push('')
    lines.push(`💸 <b>Дебиторка:</b> ${fmt(debtSum)} · ${debtors.length} счёт(ов)`)
    for (const d of debtors.slice(0, 3)) lines.push(`   • ${d.label} — ${fmt(d.debt)} (${d.days} дн)`)
    lines.push('')
    lines.push(`💰 <b>Касса:</b> сейчас ${fmt(cash)} → через 7 дней ~${fmt(cash7)}`)
    lines.push(`   приходы ~${fmt(inflow7)} · платежи ~${fmt(outflow7)}`)
    if (cash7 < 0) lines.push(`   ⚠️ <b>Кассовый разрыв на горизонте недели!</b>`)
    lines.push('')
    lines.push(`🏭 <b>Цех:</b> в работе ${tp} · в очереди ${tq}${tpr > 0 ? ` · ⚠️ проблем ${tpr}` : ''}`)
    lines.push('')
    lines.push(`🧾 <b>Вчера:</b> ${calcsY?.length ?? 0} розничных расчётов`)
    lines.push('')
    lines.push(`Подробно: /cfo/receivables · /cfo/cashflow`)

    await notifyAdmins(lines.join('\n'))
    return NextResponse.json({ ok: true, debtSum, debtors: debtors.length, cash, cash7 })
  } catch (err) {
    await notifyAdmins(`❌ Крон morning-briefing упал: ${err instanceof Error ? err.message : String(err)}`).catch(() => {})
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
