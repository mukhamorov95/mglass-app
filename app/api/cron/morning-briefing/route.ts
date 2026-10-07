import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { notifyAdmins } from '@/lib/telegram'
import { companyFixed } from '@/lib/breakeven'
import { withCronRun } from '@/lib/cronRuns'
import { loadReceivables } from '@/lib/money/receivablesLoad'
import { expectedInflow } from '@/lib/money/receivables'

export const runtime = 'nodejs'
export const maxDuration = 60

// Утренний дайджест владельцу (07:00 МСК): деньги + цех + вчерашняя активность.
// Долг клиентов — та же функция, что /cfo/receivables, /ceo и прогноз кассы (lib/money/receivables).

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
// Имена клиентов идут в HTML-режим Telegram: «<» или «&» в названии ломали бы всё сообщение.
const escapeHtml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

async function run(req: Request) {
  // CRON_FAIL_GUARD: падение крона раньше было тихим 500 — теперь пинг владельцу
  try {
    const auth = req.headers.get('authorization')
    if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    const sb = db()
    const now = new Date()
    const today = new Date(now); today.setHours(0, 0, 0, 0)
    const in7d = new Date(today.getTime() + 7 * 86400000)

    // Задачи цеха — счётчиками: открытых больше 1000, выборка упиралась в потолок PostgREST.
    const tasksWith = (status: string) => sb.from('production_tasks').select('id', { count: 'exact', head: true }).eq('status', status)
    const [{ data: fp }, { data: pp }, active, queued, problems, { data: calcsY }, rec] = await Promise.all([
      sb.from('finplan_models').select('unit,data'),
      sb.from('planned_payments').select('kind, amount, due_date').eq('status', 'planned'),
      tasksWith('in_progress'), tasksWith('queued'), tasksWith('problem'),
      sb.from('calculations').select('id, created_at')
        .gte('created_at', new Date(today.getTime() - 86400000).toISOString())
        .lt('created_at', today.toISOString()),
      // Не посчитался долг — сводка всё равно уходит, но с честной строкой вместо «0 ₽».
      loadReceivables(sb).then(r => ({ data: r, error: null }), (e: unknown) => ({ data: null, error: e instanceof Error ? e.message : String(e) })),
    ])

    // ── Долг клиентов ──
    const debtors = rec.data ? [...rec.data.rows].sort((a, b) => b.debt - a.debt) : []
    const debtSum = rec.data?.total ?? 0

    // ── Кассовый прогноз на 7 дней ──
    let cash = 0, fixedMonthly = 0
    for (const row of fp ?? []) {
      if (row.unit === 'total' && row.data?.cashBalance != null) cash = Number(row.data.cashBalance) || 0
      if (row.unit === 'mglass' || row.unit === 'production') {
        fixedMonthly += ((row.data?.fixed ?? []) as { amount?: number }[])
          .reduce((s, f) => s + (Number(f.amount) || 0), 0)
      }
    }
    fixedMonthly += companyFixed((fp ?? []) as { unit: string; data: unknown }[]).extra.reduce((s, f) => s + f.amount, 0)
    // приходы: долг, ожидаемый в окне (отгрузка или запуск + 14 дн; просроченные — в окне)
    let inflow7 = rec.data ? expectedInflow(rec.data.rows, rec.data.today) : 0
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
    const tq = queued.count ?? 0
    const tp = active.count ?? 0
    const tpr = problems.count ?? 0

    // ── Сообщение ──
    const lines: string[] = []
    lines.push(`☀️ <b>Доброе утро! Дайджест M-Glass</b>`)
    lines.push('')
    if (rec.data) {
      lines.push(`💸 <b>Долг клиентов:</b> ${fmt(debtSum)} · ${debtors.length} заказ(ов)`)
      for (const d of debtors.slice(0, 3)) lines.push(`   • ${escapeHtml(`${d.ref} ${d.client}`)} — ${fmt(d.debt)} (${d.days} дн)`)
      const cov = rec.data.coverage
      if (cov.orders > 0 && cov.withPayment < cov.orders) lines.push(`   оплаты заведены у ${cov.withPayment} из ${cov.orders} заказов — без выписки часть долга не настоящая`)
    } else {
      lines.push(`💸 <b>Долг клиентов:</b> не посчитался (${escapeHtml(rec.error ?? '')})`)
    }
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

    // Воркер задач владельца: если не отмечался >30 мин, а в очереди есть задачи —
    // они не выполняются, предупреждаем (раньше это было видно только из терминала).
    try {
      const [{ data: w }, { count: qCount }] = await Promise.all([
        sb.from('owner_task_workers').select('last_seen, machine').order('last_seen', { ascending: false }).limit(1),
        sb.from('owner_tasks').select('id', { count: 'exact', head: true }).eq('status', 'queued'),
      ])
      const lastSeen = w?.[0]?.last_seen ? new Date(w[0].last_seen).getTime() : 0
      const staleMin = lastSeen ? Math.round((Date.now() - lastSeen) / 60000) : Infinity
      const queued = qCount ?? 0
      if (staleMin > 30 && queued > 0) {
        lines.push('')
        lines.push(`🟠 <b>Воркер задач не активен</b> (${lastSeen ? `${staleMin} мин` : 'ни разу'}), а в очереди ${queued} задач(и) — не выполняются. Запустите: node scripts/owner-tasks.mjs heartbeat · /admin/owner-tasks`)
      }
    } catch { /* не валим дайджест из-за проверки воркера */ }

    // Здоровье очереди сообщений (WhatsApp→AmoCRM): если копятся ошибки доставки —
    // лиды тихо не попадают в CRM. Раньше это было видно только при заходе в
    // /admin/integrations. Порог 5, чтобы не шуметь на единичных сбоях.
    try {
      const [{ count: failedC }, { count: retryC }] = await Promise.all([
        sb.from('message_queue').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
        sb.from('message_queue').select('id', { count: 'exact', head: true }).eq('status', 'retry_scheduled'),
      ])
      const failed = failedC ?? 0, retry = retryC ?? 0
      if (failed + retry >= 5) {
        lines.push('')
        lines.push(`🟠 <b>Очередь сообщений буксует:</b> ${failed} ошибок, ${retry} в ретрае — часть входящих может не доходить в CRM. Проверьте /admin/integrations (AmoCRM: баланс/токен).`)
      }
    } catch { /* не валим дайджест */ }

    await notifyAdmins(lines.join('\n'))
    return NextResponse.json({ ok: true, debtSum, debtors: debtors.length, debtError: rec.error, cash, cash7 })
  } catch (err) {
    await notifyAdmins(`❌ Крон morning-briefing упал: ${err instanceof Error ? err.message : String(err)}`).catch(() => {})
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export const GET = (req: Request) => withCronRun('morning-briefing', req, () => run(req))
