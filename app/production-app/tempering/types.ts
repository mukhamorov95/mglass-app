// Ответ /api/production/tempering: один тип на экран и на лист.
import type { TemperRow } from '@/lib/production/tempering'

export type PoolLine = {
  key: string; layer: number; material: string; thickness: number | null; width: number | null; height: number | null
  qty: number; area: number; weight: number; free: number; drafted: number; away: number; returned: number; broken: number
  task: 'open' | 'done' | 'none'; before: string[]
}
export type PoolOrder = { id: number; no: string; client: string | null; launch_day: string; deadline_day: string | null; overdue_days: number; lines: PoolLine[] }
export type FoundOrder = { id: number; no: string; client: string | null; status: string; blocked: boolean; lines: PoolLine[] }
export type BatchLine = TemperRow & { no_rate: boolean }
export type Batch = { id: number; batch_date: string; status: 'draft' | 'sent'; created_at: string; sent_at: string | null; sent_by_name: string | null; lines: BatchLine[] }
export type TemperingData = { canMoney: boolean; today: string; pool: PoolOrder[]; batches: Batch[]; ratesMissing: string[] }

export const fmtDay = (day: string | null | undefined) => (day ? `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}` : '—')
export const fmtM2 = (n: number) => `${(Math.round(n * 100) / 100).toLocaleString('ru-RU')} м²`
export const fmtKg = (n: number) => `${(Math.round(n * 10) / 10).toLocaleString('ru-RU')} кг`
export const fmtRub = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`
export const sizeOf = (l: { width: number | null; height: number | null }) => (l.width && l.height ? `${l.width}×${l.height}` : '—')
export const thickOf = (t: number | null) => (t ? `${t} мм` : '—')
