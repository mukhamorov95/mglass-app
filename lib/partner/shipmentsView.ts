import type { PoolOrder, Shipment } from '@/app/production-app/shower-glass/types'

// Что из экрана отгрузок цеха уходит партнёру (К7, владелец 24.11). Только чтение, свой клиент.
// Не уходят: черновики отгрузок (наш план), скрытые заказы (архив, просчёт, история), внутренние
// пометки (marked_outside, rest_off, drafted/free/earlier), права упаковки. Суммы — только с правом «цены».

export type PartnerShipLine = { key: string; label: string; size: string; qty: number; amount?: number; shipped: number; packed: boolean; left?: string[] | null }
export type PartnerShipOrder = {
  id: number; no: string; client_no: string | null; urgent: boolean; urgent_rank: number | null
  launch_day: string; deadline_day: string | null; overdue_days: number
  stage: PoolOrder['stage']; state: PoolOrder['state']; packed_lines: number; ship_day: string | null; lines: PartnerShipLine[]
}
export type PartnerShipment = { id: number; ship_date: string | null; lines: { order_id: number; order_no: string; client_no: string | null; label: string; size: string; qty: number; weight: number; amount?: number; own_cost?: boolean }[] }

export function partnerOrders(orders: PoolOrder[], money: boolean): PartnerShipOrder[] {
  return orders.filter(o => !o.hidden).map(o => ({
    id: o.id, no: o.no, client_no: o.client_no, urgent: o.urgent_rank !== null && o.stage !== 'shipped', urgent_rank: o.urgent_rank,
    launch_day: o.launch_day, deadline_day: o.deadline_day, overdue_days: o.overdue_days,
    stage: o.stage, state: o.state, packed_lines: o.packed_lines, ship_day: o.marked_day,
    lines: o.lines.map(l => ({
      key: l.key, label: l.label, size: l.size, qty: l.qty, shipped: l.shipped, packed: l.packed,
      ...(money && l.amount !== undefined ? { amount: l.amount } : {}),
      ...(l.left !== undefined ? { left: l.left } : {}),
    })),
  }))
}

export function partnerShipments(list: Shipment[], money: boolean): PartnerShipment[] {
  return list.filter(h => h.status === 'shipped').map(h => ({
    id: h.id, ship_date: h.ship_date,
    lines: h.lines.map(l => ({
      order_id: l.order_id, order_no: l.order_no, client_no: l.client_no, label: l.label, size: l.size, qty: l.qty, weight: l.weight,
      ...(money ? { amount: l.amount, own_cost: !!l.own_cost } : {}),
    })),
  }))
}
