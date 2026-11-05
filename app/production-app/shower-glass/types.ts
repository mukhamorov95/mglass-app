// Ответ /api/production/client-shipments: один тип на экран и на лист отгрузки.
import type { OrderHidden, OrderShipState, OrderStage } from '@/lib/production/clientShipments'

export type OrderLine = {
  key: string; label: string; size: string; qty: number; weight: number; amount?: number
  shipped: number; drafted: number; free: number; packed: boolean
}
export type PoolOrder = {
  id: number; no: string; launch_day: string; deadline_day: string | null; overdue_days: number
  paid: boolean; state: OrderShipState; stage: OrderStage; packed_lines: number
  marked_day: string | null; marked_outside: boolean; hidden: OrderHidden | null; archived_day: string | null; lines: OrderLine[]
}
export type ShipmentLine = {
  order_id: number; order_no: string; key: string; label: string; size: string
  qty: number; lineQty: number; weight: number; amount: number
}
export type Shipment = {
  id: number; ship_date: string | null; status: 'draft' | 'shipped'; shipped_at: string | null
  lines: ShipmentLine[]
}
export type ShipmentsData = { canMoney: boolean; canPack: boolean; title: string; today: string; orders: PoolOrder[]; shipments: Shipment[] }

export const fmtDay = (day: string | null | undefined) => (day ? `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}` : 'без даты')
export const fmtKg = (n: number) => `${(Math.round(n * 10) / 10).toLocaleString('ru-RU')} кг`
export const fmtRub = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`
