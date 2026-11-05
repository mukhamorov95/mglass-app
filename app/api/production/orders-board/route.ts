import { NextRequest, NextResponse } from 'next/server'
import { requirePageAccess } from '@/lib/apiAuth'
import { getUserProfile } from '@/lib/getRole'
import { createServiceClient } from '@/lib/supabase-service'
import { isDayKey } from '@/lib/b2b/clientReport'
import { isShipped, orderDeadline, type TodayOrder } from '@/lib/b2b/todayPriorities'
import { orderAmount } from '@/lib/liveOrders'
import { PROD_SINCE, isUrgent, parseNotes } from '@/lib/orderFlags'
import { orderHidden, orderShipState, shipLines, type EarlierLines, type ShipOrder } from '@/lib/production/clientShipments'
import { boardOverdue, boardStage, idleDays, lastMarkOf, shipMarkOf, stageCounts, type BoardOrder, type BoardTask } from '@/lib/production/ordersBoard'
import { readIn, readPaged } from '@/lib/production/paged'
import { inShopScope, shopScopeOf } from '@/lib/production/shopScope'
import { mskDayKey } from '@/lib/time'

// Табло «Заказы»: список считает сервер, потому что заказов сотни, а задач тысячи. Сумма только тем, кому открыты деньги.

const PAGE = '/production-app/orders'
const ORDER_COLS = 'id, client_id, client_name, custom_number, items, notes, created_at, launched_at, archived_at, discount_percent, total_after_discount, total_sale_inc_vat'
const TASK_COLS = 'order_id, item_index, stage_key, status, sequence_order, completed_at, completed_by_name, auto_closed, auto_closed_by_name, auto_closed_from'

type Svc = ReturnType<typeof createServiceClient>
type RawOrder = ShipOrder & { id: number; client_id: number | null; client_name: string | null; custom_number: string | null; notes: string | null; created_at: string; launched_at: string | null; archived_at: string | null }
type TaskRow = BoardTask & { order_id: number }
type ItemRow = { shipment_id: number; order_id: number; line_key: string; qty: number }

function dayOf(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null
  const t = new Date(v)
  return Number.isNaN(t.getTime()) ? null : mskDayKey(t)
}

async function loadLedger(svc: Svc, ids: number[]) {
  const items = await readIn<ItemRow, number>(ids, (part, a, b) => svc.from('delivery_shipment_items').select('shipment_id, order_id, line_key, qty').in('order_id', part).range(a, b) as never)
  const heads = await readIn<{ id: number; ship_date: string | null }, number>([...new Set(items.map(i => i.shipment_id))], (part, a, b) =>
    svc.from('delivery_shipments').select('id, ship_date').eq('status', 'shipped').in('id', part).range(a, b) as never)
  const shipDay = new Map(heads.map(h => [h.id, h.ship_date]))
  return { items: items.filter(i => shipDay.has(i.shipment_id)), shipDay }
}

export async function GET(req: NextRequest) {
  const guard = await requirePageAccess(PAGE)
  if (guard instanceof NextResponse) return guard
  const profile = await getUserProfile()
  const canMoney = profile?.canViewMoney === true
  const svc = createServiceClient()
  const url = new URL(req.url)
  const today = mskDayKey()
  try {
    const id = Number(url.searchParams.get('id'))
    if (id > 0) return await detail(svc, id)

    const scope = shopScopeOf(url.searchParams.get('client'))
    const to = url.searchParams.get('to') ?? today
    if (!isDayKey(to)) return NextResponse.json({ error: 'Проверьте дату.' }, { status: 400 })

    const raw = (await readPaged<RawOrder>((a, b) => svc.from('b2b_orders').select(ORDER_COLS)
      .gte('created_at', PROD_SINCE).is('archived_at', null).not('launched_at', 'is', null).order('id', { ascending: true }).range(a, b) as never))
      .filter(o => !orderHidden(o.archived_at, parseNotes(o.notes)) && inShopScope(scope, o))
    const ids = raw.map(o => o.id)
    const [tasks, ledger] = await Promise.all([
      readIn<TaskRow, number>(ids, (part, a, b) => svc.from('production_tasks').select(TASK_COLS).in('order_id', part).range(a, b) as never),
      loadLedger(svc, ids),
    ])
    const tasksOf = new Map<number, TaskRow[]>()
    for (const t of tasks) tasksOf.set(t.order_id, [...(tasksOf.get(t.order_id) ?? []), t])
    const rowsOf = new Map<number, ItemRow[]>()
    for (const r of ledger.items) rowsOf.set(r.order_id, [...(rowsOf.get(r.order_id) ?? []), r])

    const orders: BoardOrder[] = raw.flatMap(o => {
      const notes = parseNotes(o.notes)
      const launchDay = dayOf(o.launched_at)
      if (launchDay && launchDay > to) return []
      const stagesNote = (notes.stages ?? {}) as Record<string, unknown>
      const markDay = typeof stagesNote.shipped === 'string' ? dayOf(stagesNote.shipped) : null
      const marked = isShipped(notes) && (!markDay || markDay <= to)
      const lines = shipLines(o)
      const earlier = (notes.shipped_earlier as { lines?: EarlierLines } | null | undefined)?.lines ?? {}
      const rows = (rowsOf.get(o.id) ?? []).filter(r => { const d = ledger.shipDay.get(r.shipment_id); return !d || d <= to })
      const shippedOf = (key: string) => rows.filter(r => r.line_key === key).reduce((n, r) => n + r.qty, 0) + (earlier[key] ?? 0)
      const pieces = lines.reduce((n, l) => n + l.qty, 0)
      const state = marked ? 'full' as const : orderShipState(lines, shippedOf)
      const shipped = marked || state === 'full'
      const lastLedgerDay = rows.map(r => ledger.shipDay.get(r.shipment_id)).filter((d): d is string => !!d).sort().pop() ?? null
      const orderTasks = tasksOf.get(o.id) ?? []
      const stage = boardStage(orderTasks, to, shipped)
      const deadlineDay = dayOf(orderDeadline(o as unknown as TodayOrder, notes as never).toISOString())
      const last = lastMarkOf(orderTasks, to)
      return [{
        id: o.id, no: o.custom_number?.trim() || `00${o.id}`, client: o.client_name ?? '', client_id: o.client_id,
        urgent: isUrgent(o.notes), paid: !!stagesNote.invoice_paid, problem: orderTasks.some(t => t.status === 'problem'),
        launch_day: launchDay, deadline_day: deadlineDay, overdue_days: boardOverdue(deadlineDay, to, stage),
        positions: lines.length, pieces, weight: Math.round(lines.reduce((n, l) => n + l.weight, 0) * 10) / 10,
        ...(canMoney ? { amount: orderAmount(o as never) } : {}),
        stage, state, shipped_pieces: marked ? pieces : lines.reduce((n, l) => n + Math.min(l.qty, shippedOf(l.key)), 0),
        ship_day: shipped ? markDay ?? lastLedgerDay : null,
        stages: stageCounts(orderTasks, to), last_mark: last, idle_days: stage === 'in_work' ? idleDays(last, launchDay, to) : null,
      }]
    })
    return NextResponse.json({ today, to, orders })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Ошибка загрузки' }, { status: 500 })
  }
}

// Раскрытый заказ, в том числе уехавший: все этапы с автором и временем, отгрузки по дням.
async function detail(svc: Svc, id: number) {
  const { data, error } = await svc.from('b2b_orders').select(ORDER_COLS).eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return NextResponse.json({ error: 'Такого заказа нет.' }, { status: 404 })
  const o = data as unknown as RawOrder
  const notes = parseNotes(o.notes)
  const { data: tasks, error: tErr } = await svc.from('production_tasks')
    .select(`id, station, rework_count, problem_reason_code, problem_comment, problem_at, problem_by_name, ${TASK_COLS}`)
    .eq('order_id', id).order('sequence_order').order('id')
  if (tErr) throw new Error(tErr.message)
  const ledger = await loadLedger(svc, [id])
  const byDay = new Map<string, number>()
  for (const r of ledger.items) {
    const d = ledger.shipDay.get(r.shipment_id) ?? ''
    byDay.set(d, (byDay.get(d) ?? 0) + r.qty)
  }
  const earlier = Object.values((notes.shipped_earlier as { lines?: EarlierLines } | null | undefined)?.lines ?? {}).reduce((n, q) => n + q, 0)
  return NextResponse.json({
    id: o.id, items: Array.isArray(o.items) ? o.items : [], drawing_url: typeof notes.drawing_url === 'string' ? notes.drawing_url : null,
    launched_at: o.launched_at, tasks: tasks ?? [],
    shipments: [...byDay.entries()].map(([day, pieces]) => ({ day: day || null, pieces })).sort((a, b) => (a.day ?? '').localeCompare(b.day ?? '')),
    earlier_pieces: earlier, ship_mark: shipMarkOf(notes as Parameters<typeof shipMarkOf>[0]),
  })
}
