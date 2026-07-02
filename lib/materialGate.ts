// Единая проверка «материал приехал» для этапа резки.
// Раньше жила только в UI станции (station/[station]) → обходилась через my-queue и /p/o.
// ARRIVED = материал забран/закрыт. Заказ блокируется на резке, если по нему есть
// заявка в закупках и ни одна не «приехала». Нет заявки → режем со склада (не блокируем).

export const ARRIVED_PO_STATUSES = new Set(['picked_up', 'closed'])

type PoRow = { b2b_order_ids: number[] | null; status: string }

export function isCuttingBlocked(orderId: number, poRows: PoRow[]): boolean {
  const relevant = poRows.filter(po => Array.isArray(po.b2b_order_ids) && po.b2b_order_ids.includes(orderId))
  if (relevant.length === 0) return false
  return !relevant.some(po => ARRIVED_PO_STATUSES.has(po.status))
}
