import type { VisitPayment } from '@/lib/measure/money'

// Заявка на замер так, как её отдаёт GET /api/measure-requests (REQ_COLS).
export type MeasureReq = {
  id: number
  deal_id: number | null
  deal_number: string | null
  client_name: string
  phone: string | null
  amo_url: string | null
  address: string | null
  scope: string | null
  notes: string | null
  visit_price: number
  payer: string | null
  is_repeat: boolean
  manager_id: string | null
  manager_name: string | null
  measurer_id: string | null
  measurer_name: string | null
  scheduled_at: string | null
  duration_min: number | null
  travel_min: number | null
  status: string
  issue_text: string | null
  issue_solution: string | null
  measurer_fee: number
  fee_status: string
  actual_price: number | null
  price_note: string | null
  visit_payment: VisitPayment | null
  result_note: string | null
  repeat_of: number | null
  cancel_reason?: string | null
  cancelled_by_name?: string | null
  cancelled_at?: string | null
  photos: string[] | null
  created_at: string
}

export type MeasureMe = { id: string; name: string; role: string; scope: string; canCreate: boolean }
export type MeasurerLite = { id: string; name: string }

export const STATUS_META: Record<string, { label: string; cls: string }> = {
  new:       { label: '🆕 Ждёт замерщика', cls: 'bg-amber-50 text-amber-700' },
  scheduled: { label: '📅 Назначен',       cls: 'bg-blue-50 text-blue-700' },
  done:      { label: '✅ Выполнен',       cls: 'bg-emerald-50 text-emerald-700' },
  issue:     { label: '⚠️ Сложность',      cls: 'bg-red-50 text-red-700' },
  cancelled: { label: '✕ Отменён',        cls: 'bg-[#f0f0ec] text-[#9a9a95]' },
}
