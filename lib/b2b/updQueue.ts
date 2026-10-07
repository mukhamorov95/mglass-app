// «Ждут УПД» в «Бухгалтерия → УПД» (этап 8 docs/b2b/ORDER_PANEL_ROUTE.md): отгружено после
// переключения на приложение, а УПД не выдан. До переключения УПД выписывает программа,
// поэтому более ранние отгрузки сюда не попадают — иначе список был бы из сотен «долгов».

import { parseNotes, isShipped, orderRef } from '@/lib/b2b/todayPriorities'
import { stageDayKey } from '@/lib/production/dayLists'
import { mskDayKey } from '@/lib/time'
import { finalTotalOf } from '@/lib/b2b/priceOverride'

export type QueueOrder = {
  id: number
  custom_number: string | null
  client_id: number | null
  client_name: string | null
  notes: string | null
  created_at: string
  launched_at: string | null
  total_after_discount: number | null
  total_sale_inc_vat: number | null
}

export type WaitingRow = { id: number; ref: string; client: string; shippedDay: string; total: number }

export type UpdQueue = {
  rows: WaitingRow[]
  noInn: number        // отгружены после переключения, но у клиента нет ИНН — УПД не выдать
  undated: number      // заказ после переключения отмечен «Отгружен» без даты — дату УПД выбрать вручную
}

export function updQueue(
  orders: QueueOrder[], issuedOrderIds: Set<number>, innClientIds: Set<number>, switchDay: string,
): UpdQueue {
  const rows: WaitingRow[] = []
  let noInn = 0, undated = 0
  for (const o of orders) {
    if (issuedOrderIds.has(o.id)) continue
    const n = parseNotes(o.notes)
    if (!o.launched_at && !n.launched_at) continue
    if (!isShipped(n)) continue
    const day = stageDayKey((n.stages as Record<string, unknown> | undefined)?.shipped)
    // Старое `true` без даты: у заказа, созданного до переключения, это отгрузка программы.
    if (!day) { if (mskDayKey(o.created_at) >= switchDay) undated++; continue }
    if (day < switchDay) continue
    if (o.client_id == null || !innClientIds.has(o.client_id)) { noInn++; continue }
    rows.push({ id: o.id, ref: orderRef(o), client: o.client_name?.trim() || '—', shippedDay: day, total: finalTotalOf(o) })
  }
  rows.sort((a, b) => a.shippedDay.localeCompare(b.shippedDay) || a.id - b.id)
  return { rows, noInn, undated }
}
