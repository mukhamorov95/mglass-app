import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { notifyAdmins } from '@/lib/telegram'

export const maxDuration = 120

// Страховочная сетка по ЦЕХУ (дополняет денежную money-integrity). Ловит два
// НАДЁЖНЫХ «тихих» класса бед, которые раньше замечались только глазами:
//
// (1) ЗАПУЩЕН, НО БЕЗ ЗАДАЧ — launched_at стоит, а в production_tasks ноль строк.
//     Генерация задач при запуске упала → цех этот заказ не видит вообще.
//     Только СВЕЖИЕ (30 дней): production_tasks появились 30.06.2026, заказы до
//     этого штатно шли по detail_stages и задач не имеют (их ~270 — история, не сбой).
//
// (2) НЕРЕШЁННАЯ ПРОБЛЕМА > 3 дней — андон-сигнал (бой/скол/нет материала) висит,
//     никто не снял. Статус проблемы ставится явно и атомарно → сигнал надёжный.
//
// «Застрял по незакрытым этапам» сознательно НЕ проверяем: старые заказы,
// закрытые через detail_stages, показывают незакрытые production_tasks — это шум,
// а не стоп. Уйдёт после консолидации зеркал.
//
// Пишет владельцу в Telegram ТОЛЬКО когда есть находки.

const NO_TASKS_DAYS = 30
const PROBLEM_STALE_DAYS = 3

function daysSince(d: string): number {
  return Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000)
}
const label = (o: { custom_number: string | null; id: number; client_name: string | null }) =>
  `#${o.custom_number ?? o.id} ${o.client_name ?? ''}`.trim()

type OrderRow = { id: number; custom_number: string | null; client_name: string | null; launched_at: string }

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const svc = createServiceClient()
  const since = new Date(Date.now() - NO_TASKS_DAYS * 86_400_000).toISOString().slice(0, 10)

  // (1) Запущенные за 30 дней заказы (не архивные) — ищем те, у кого нет ни одной задачи.
  const { data: ordersRaw } = await svc.from('b2b_orders')
    .select('id, custom_number, client_name, launched_at')
    .is('archived_at', null).gte('launched_at', since).order('launched_at')
  const orders = (ordersRaw ?? []) as OrderRow[]

  const withTasks = new Set<number>()
  if (orders.length) {
    const ids = orders.map(o => o.id)
    for (let from = 0; ; from += 1000) {
      const { data: page } = await svc.from('production_tasks')
        .select('order_id').in('order_id', ids).range(from, from + 999)
      const rows = (page ?? []) as { order_id: number }[]
      for (const r of rows) withTasks.add(r.order_id)
      if (rows.length < 1000) break
    }
  }
  const noTasks = orders.filter(o => !withTasks.has(o.id))

  // (2) Нерешённые проблемы старше 3 дней — берём order_id, подтягиваем ярлыки.
  const problemSince = new Date(Date.now() - PROBLEM_STALE_DAYS * 86_400_000).toISOString()
  const { data: probRows } = await svc.from('production_tasks')
    .select('order_id, problem_reason_code, problem_at')
    .eq('status', 'problem').is('problem_resolved_at', null).lt('problem_at', problemSince)
  const probByOrder = new Map<number, { reason: string | null; at: string }>()
  for (const p of (probRows ?? []) as { order_id: number; problem_reason_code: string | null; problem_at: string }[]) {
    if (!probByOrder.has(p.order_id)) probByOrder.set(p.order_id, { reason: p.problem_reason_code, at: p.problem_at })
  }
  let problemOrders: OrderRow[] = []
  if (probByOrder.size) {
    const { data: po } = await svc.from('b2b_orders')
      .select('id, custom_number, client_name, launched_at').in('id', [...probByOrder.keys()])
    problemOrders = (po ?? []) as OrderRow[]
  }

  if (noTasks.length === 0 && problemOrders.length === 0) {
    return NextResponse.json({ ok: true, noTasks: 0, staleProblems: 0 })
  }

  const lines = ['🏭 <b>Сверка цеха: есть расхождения</b>', '']
  if (noTasks.length) {
    lines.push(`⛔️ <b>Запущены, но БЕЗ задач в цехе (${noTasks.length})</b> — цех их не видит:`)
    noTasks.slice(0, 10).forEach(o => lines.push(`• ${label(o)} — запущен ${o.launched_at}`))
    if (noTasks.length > 10) lines.push(`…и ещё ${noTasks.length - 10}`)
    lines.push('')
  }
  if (problemOrders.length) {
    lines.push(`⚠️ <b>Нерешённые проблемы > ${PROBLEM_STALE_DAYS} дн. (${problemOrders.length})</b>:`)
    problemOrders.slice(0, 10).forEach(o => {
      const p = probByOrder.get(o.id)
      lines.push(`• ${label(o)} — ${p?.reason ?? 'проблема'}, ${p ? daysSince(p.at) : '?'} дн.`)
    })
    if (problemOrders.length > 10) lines.push(`…и ещё ${problemOrders.length - 10}`)
  }

  await notifyAdmins(lines.join('\n')).catch(() => {})
  return NextResponse.json({ ok: true, noTasks: noTasks.length, staleProblems: problemOrders.length })
}
