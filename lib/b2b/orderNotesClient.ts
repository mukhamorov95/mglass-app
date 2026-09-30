import { loadJson } from '@/lib/toast'

// Экранная сторона /api/b2b-quotes/[id]/notes: шлём намерение, а не notes целиком.
// В ответе — notes после записи и колонки, которые записал сервер, для локального стейта.
export type OrderNotesAction =
  | { action: 'status'; to: string; comment?: string | null; revertToDraft?: boolean }
  | { action: 'launch'; workDate: string; deadline?: string | null; drawingUrl?: string | null; customNumber?: string | null }
  | { action: 'template'; value: boolean }
  | { action: 'kp-options'; kp_payment_terms?: string; kp_price_mode?: string }

export type OrderNotesSaved = { notes: string | null; columns: Record<string, unknown> }

export function saveOrderNotes(orderId: number, body: OrderNotesAction) {
  return loadJson<OrderNotesSaved>(`/api/b2b-quotes/${orderId}/notes`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}
