// Ответ /api/production/client-shipments: один тип на экран и на лист отгрузки.
import type { OrderShipState } from '@/lib/production/clientShipments'

export type OrderLine = {
  key: string; label: string; size: string; qty: number; weight: number; amount?: number
  shipped: number; drafted: number; free: number; packed: boolean
}
export type PoolOrder = {
  id: number; no: string; created_at: string; paid: boolean; state: OrderShipState
  marked_shipped: string | null; marked_outside: boolean; lines: OrderLine[]
}
export type ShipmentLine = {
  order_id: number; order_no: string; key: string; label: string; size: string
  qty: number; lineQty: number; weight: number; amount: number
}
export type Shipment = {
  id: number; ship_date: string | null; status: 'draft' | 'shipped'; shipped_at: string | null
  lines: ShipmentLine[]
}
export type ShipmentsData = { canMoney: boolean; title: string; today: string; orders: PoolOrder[]; shipments: Shipment[] }

export const fmtDay = (day: string | null | undefined) => (day ? `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}` : 'без даты')
export const fmtKg = (n: number) => `${(Math.round(n * 10) / 10).toLocaleString('ru-RU')} кг`
export const fmtRub = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`
