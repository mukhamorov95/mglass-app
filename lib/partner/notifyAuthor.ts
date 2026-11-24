import { shipMarkOf } from '@/lib/production/ordersBoard'

// Кто поставил этап, о котором уведомление (владелец 24.11): «принят в работу» — кто запустил,
// «готов» — кто закрыл упаковку последним, «отгружен» — кто отметил отгрузку.
type Notes = Record<string, unknown>
type Pack = { order_id: number; completed_at: string | null; completed_by_name: string | null; auto_closed_by_name?: string | null }

export function notifyAuthor(kind: string, notes: Notes | undefined, packs: Pack[]): string | null {
  if (!notes) return null
  if (kind === 'in_work') return typeof notes.launched_by_name === 'string' && notes.launched_by_name ? notes.launched_by_name : null
  if (kind === 'shipped') return shipMarkOf(notes as Parameters<typeof shipMarkOf>[0])?.by ?? null
  if (kind === 'ready') {
    const last = [...packs].filter(p => p.completed_at).sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))[0]
    return last ? last.completed_by_name ?? last.auto_closed_by_name ?? null : null
  }
  return null
}
