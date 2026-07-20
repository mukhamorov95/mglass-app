import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { notifyAdmins } from '@/lib/telegram'

export const maxDuration = 120

// Д4: ежедневный контроль ведомости продаж на время параллели с Google-таблицей.
// Ищет две беды: (1) оплаченный заказ без строки продажи — деньги есть, продажи
// нет; (2) строки needs_review старше суток — менеджер не дозаполнил способ
// оплаты/партнёрские. Пишет владельцу в Telegram только когда есть что сказать.

const RUB = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const svc = createServiceClient()

  const { data: payRows } = await svc.from('payments')
    .select('b2b_order_id, amount').is('voided_at', null).not('b2b_order_id', 'is', null)
  const paidOrders = new Map<number, number>()
  for (const p of (payRows ?? []) as { b2b_order_id: number; amount: number }[]) {
    paidOrders.set(p.b2b_order_id, (paidOrders.get(p.b2b_order_id) ?? 0) + Number(p.amount))
  }

  const { data: saleRows } = await svc.from('crm_sales')
    .select('b2b_order_id').not('b2b_order_id', 'is', null).eq('voided', false)
  const inLedger = new Set((saleRows ?? []).map(s => (s as { b2b_order_id: number }).b2b_order_id))

  const orphans = [...paidOrders.entries()].filter(([id]) => !inLedger.has(id))
  const orphanSum = orphans.reduce((s, [, amt]) => s + amt, 0)

  const yesterday = new Date(Date.now() - 86_400_000).toISOString()
  const { data: stale, count: staleCount } = await svc.from('crm_sales')
    .select('order_no, client, amount, manager', { count: 'exact' })
    .eq('needs_review', true).eq('voided', false).lt('created_at', yesterday)
    .order('created_at').limit(10)

  const staleRows = (stale ?? []) as { order_no: string | null; client: string; amount: number; manager: string | null }[]

  if (orphans.length > 0 || staleRows.length > 0) {
    const lines = ['🧮 <b>Сверка ведомости продаж</b>']
    if (orphans.length > 0) {
      lines.push(`\n⚠️ Оплачено, но нет строки продажи: <b>${orphans.length}</b> на ${RUB(orphanSum)}`)
      lines.push(orphans.slice(0, 5).map(([id, amt]) => `• заказ #${id} — ${RUB(amt)}`).join('\n'))
    }
    if (staleRows.length > 0) {
      lines.push(`\n📝 Ждут дозаполнения больше суток: <b>${staleCount}</b>`)
      lines.push(staleRows.slice(0, 5).map(r =>
        `• ${r.order_no ?? '—'} · ${r.client.slice(0, 24)} · ${RUB(Number(r.amount))}${r.manager ? ` · ${r.manager}` : ''}`).join('\n'))
    }
    await notifyAdmins(lines.join('\n')).catch(() => {})
  }

  return NextResponse.json({
    ok: true, orphans: orphans.length, orphanSum, needsReviewStale: staleCount ?? 0,
  })
}
