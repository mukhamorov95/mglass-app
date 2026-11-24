import { createServiceClient } from '@/lib/supabase-service'
import { ownCostRemakeOf } from '@/lib/b2b/ownCostRemake'
import { readIn, readPaged } from '@/lib/production/paged'
import { mskDayKey } from '@/lib/time'
import { isLaunched, isShipped, orderDeadline, type TodayOrder } from '@/lib/b2b/todayPriorities'
import {
  SHOWER_GLASS, addEarlier, orderHidden, orderShipState, orderStage, overdueDays, packedLineCount, shareOf, shipLines, takenByLine,
  type EarlierLines, type ShipOrder, type ShipRow,
} from '@/lib/production/clientShipments'
import { leftStages, shipUrgentOf, type StageTask } from '@/lib/production/urgentShip'

// Чтение экрана «Отгрузка Шовер Гласс» — одна функция для цеха (/production-app/shower-glass)
// и для кабинета партнёра (/partner/shipments): цифры в двух местах не расходятся.
// Сумма только при canMoney. Проверка роли — на стороне вызывающего маршрута.

export const REGION = SHOWER_GLASS.region
export const SHIPPED_MARKS_SINCE = '2026-07-01'

export type Svc = ReturnType<typeof createServiceClient>
export type RawOrder = ShipOrder & { id: number; custom_number: string | null; client_order_number?: string | null; notes: string | null; created_at: string; launched_at?: string | null; archived_at?: string | null; client_id?: number | null }
export type Head = { id: number; ship_date: string | null; status: string; shipped_at: string | null; created_at: string; total_weight_kg: number | null; title: string | null }
export type ItemRow = ShipRow & { label: string | null; weight_kg: number | null; amount: number | null }
export type Notes = { shipped_earlier?: { lines?: EarlierLines; by?: string; at?: string } | null; ship_rest_off?: boolean | null; status?: string; historical?: boolean; launched_at?: string | null; stages?: Record<string, string | null>; client_shipment?: { id: number; date: string; prev_shipped: string | null } | null }

export const ORDER_COLS = 'id, custom_number, client_order_number, items, notes, created_at, launched_at, archived_at, client_id, discount_percent, total_after_discount, total_sale_inc_vat'
export const orderNo = (o: { custom_number: string | null; id: number }) => o.custom_number?.trim() || `00${o.id}`
// Дата из notes бывает кривой: один заказ не должен ронять весь экран.
export function dayOf(v: Date | string | null | undefined): string | null {
  const t = v ? new Date(v) : null
  return t && !Number.isNaN(t.getTime()) ? mskDayKey(t) : null
}

export function notesOf(raw: string | null): Notes {
  try { return raw ? JSON.parse(raw) as Notes : {} } catch { return {} }
}

export function withEarlier(taken: ReturnType<typeof takenByLine>, orders: RawOrder[]) {
  for (const o of orders) addEarlier(taken, o.id, notesOf(o.notes).shipped_earlier?.lines)
  return taken
}

export async function loadHeads(svc: Svc): Promise<Head[]> {
  const { data, error } = await svc.from('delivery_shipments')
    .select('id, ship_date, status, shipped_at, created_at, total_weight_kg, title')
    .eq('region', REGION).order('id', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as Head[]
}

export async function loadRows(svc: Svc, shipmentIds: number[]): Promise<ItemRow[]> {
  return readIn<ItemRow, number>(shipmentIds, (part, from, to) => svc.from('delivery_shipment_items')
    .select('shipment_id, order_id, line_key, qty, label, weight_kg, amount')
    .in('shipment_id', part).range(from, to) as never)
}

export async function loadOrders(svc: Svc, ids: number[]): Promise<RawOrder[]> {
  return readIn<RawOrder, number>(ids, (part, from, to) => svc.from('b2b_orders')
    .select(ORDER_COLS).in('id', part).range(from, to) as never)
}


export async function readClientShipments(svc: Svc, canMoney: boolean) {
    const heads = await loadHeads(svc)
    const rows = await loadRows(svc, heads.map(h => h.id))
    const statusById = new Map(heads.map(h => [h.id, h.status]))
    const taken = takenByLine(rows, id => statusById.get(id))

    const clientOrders = await readPaged<RawOrder>((from, to) => svc.from('b2b_orders')
      .select(ORDER_COLS).eq('client_id', SHOWER_GLASS.clientId)
      .order('id', { ascending: true }).range(from, to) as never)
    const known = new Set(clientOrders.map(o => o.id))
    const extraIds = [...new Set(rows.map(r => r.order_id))].filter(id => !known.has(id))
    const orders = [...clientOrders, ...await loadOrders(svc, extraIds)]
    const byId = new Map(orders.map(o => [o.id, o]))
    withEarlier(taken, orders)

    // Упаковано по строке: задача упаковки закрыта или заказ целиком отмечен упакованным.
    const packedKeys = new Set<string>()
    const tasks = await readIn<{ order_id: number; item_index: number | null }, number>(orders.map(o => o.id), (part, from, to) =>
      svc.from('production_tasks').select('order_id, item_index').eq('stage_key', 'packaging').eq('status', 'done').in('order_id', part).range(from, to) as never)
    for (const t of tasks) packedKeys.add(`${t.order_id}:${t.item_index}`)

    // Для срочных — что по каждому изделию ещё не сделано.
    const urgentIds = orders.filter(o => shipUrgentOf(o.notes)).map(o => o.id)
    const urgentTasks = await readIn<StageTask & { order_id: number }, number>(urgentIds, (part, from, to) =>
      svc.from('production_tasks').select('order_id, item_index, stage_key, status, sequence_order').in('order_id', part).range(from, to) as never)

    const money = (n: number | null | undefined) => (canMoney ? Number(n ?? 0) : undefined)

    const today = mskDayKey()
    const views = orders.flatMap(o => {
      const notes = notesOf(o.notes)
      const stages = notes.stages ?? {}
      const inShipment = rows.some(r => r.order_id === o.id)
      const hidden = inShipment ? null : orderHidden(o.archived_at, notes)
      const urgent = shipUrgentOf(notes)
      const myTasks = urgent ? urgentTasks.filter(t => t.order_id === o.id) : []
      const lines = shipLines(o).map(l => {
        const t = taken.get(`${o.id}:${l.key}`) ?? { shipped: 0, drafted: 0 }
        return {
          ...(urgent ? { left: leftStages(myTasks, l.index) } : {}),
          key: l.key, label: l.label, size: l.size, qty: l.qty, weight: l.weight, amount: money(l.amount),
          shipped: t.shipped, drafted: t.drafted, earlier: t.earlier ?? 0, free: Math.max(0, l.qty - t.shipped - t.drafted),
          packed: !!stages.packaged || packedKeys.has(`${o.id}:${l.index}`),
        }
      })
      const state = orderShipState(lines, k => lines.find(l => l.key === k)?.shipped ?? 0)
      const markedOutside = !!stages.shipped && !notes.client_shipment && !inShipment
      if ((markedOutside || hidden) && o.created_at.slice(0, 10) < SHIPPED_MARKS_SINCE) return []
      const stage = orderStage(lines, state, isShipped(notes))
      // Срок только у запущенного: у незапущенного он считался бы от даты создания, а это выдумка.
      const asToday = o as unknown as TodayOrder
      const deadlineDay = !hidden && isLaunched(asToday, notes) ? dayOf(orderDeadline(asToday, notes)) : null
      return [{
        id: o.id, no: orderNo(o), client_no: o.client_order_number?.trim() || null, urgent_rank: urgent?.rank ?? null, urgent_lines: urgent?.lines ?? null, launch_day: dayOf(o.launched_at ?? notes.launched_at) ?? o.created_at.slice(0, 10), deadline_day: deadlineDay,
        overdue_days: overdueDays(deadlineDay, today, stage), paid: !!stages.invoice_paid, state, stage, packed_lines: packedLineCount(lines),
        marked_day: typeof stages.shipped === 'string' ? dayOf(stages.shipped) : null, marked_outside: markedOutside,
        hidden, archived_day: dayOf(o.archived_at), rest_off: !!notes.ship_rest_off, lines,
      }]
    })

    const shipments = heads.map(h => ({
      id: h.id, ship_date: h.ship_date, status: h.status, shipped_at: h.shipped_at,
      lines: rows.filter(r => r.shipment_id === h.id).map(r => {
        const o = byId.get(r.order_id)
        const line = o ? shipLines(o).find(l => l.key === r.line_key) : undefined
        const from = taken.get(`${r.order_id}:${r.line_key}`)?.shipped ?? 0
        // В черновике вес и сумма считаются по заказу сейчас, у отправленной — снимок.
        const live = h.status !== 'shipped' && line
        return {
          order_id: r.order_id, order_no: o ? orderNo(o) : String(r.order_id), client_no: o?.client_order_number?.trim() || null, own_cost: !!ownCostRemakeOf(o?.notes), key: r.line_key,
          label: r.label ?? line?.label ?? 'Строка удалена из заказа', size: r.label ? '' : line?.size ?? '',  // в снимке размер уже в названии
          qty: r.qty, lineQty: line?.qty ?? r.qty,
          weight: live ? shareOf(line.weight, line.qty, from, r.qty) : Number(r.weight_kg ?? 0),
          amount: money(live ? shareOf(line.amount, line.qty, from, r.qty) : r.amount),
        }
      }),
    }))

    return { today, orders: views, shipments }
}
