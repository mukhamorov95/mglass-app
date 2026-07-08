// Флаги заказа живут в b2b_orders.notes (JSON), рядом с launched_at/deadline_date/
// detail_stages — единый паттерн для order-level данных. Никакой отдельной колонки.

export type MaterialStatus = 'ready' | 'needed'

export function parseNotes(notes: unknown): Record<string, unknown> {
  if (notes == null) return {}
  try {
    const n = typeof notes === 'string' ? JSON.parse(notes) : notes
    return n && typeof n === 'object' ? n as Record<string, unknown> : {}
  } catch { return {} }
}

export function materialStatus(notes: unknown): MaterialStatus | null {
  const s = parseNotes(notes).material_status
  return s === 'ready' || s === 'needed' ? s : null
}

export function isUrgent(notes: unknown): boolean {
  return parseNotes(notes).urgent === true
}

export function deadlineOf(notes: unknown): string | null {
  const d = parseNotes(notes).deadline_date
  return typeof d === 'string' && d ? d : null
}

export function launchedOf(notes: unknown): string | null {
  const n = parseNotes(notes)
  const d = n.launched_at ?? n.work_started_at
  return typeof d === 'string' && d ? d : null
}

// Дней до даты (сегодня = 0, вчера = -1). null если даты нет/битая.
export function daysUntil(dateStr?: string | null): number | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  d.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - today.getTime()) / 86400000)
}

// Приоритет заказа: срочные — в самый верх, затем по возрастанию дней до отгрузки
// (просрочка = отрицательные = выше всех), заказы без срока — в конце.
export function urgencyRank(notes: unknown): number {
  if (isUrgent(notes)) return -1e9
  const d = daysUntil(deadlineOf(notes))
  return d == null ? 1e9 : d
}

// Тон карточки по срочности: red — горит/просрочка/срочно, amber — скоро, none — обычный.
export function urgencyTone(notes: unknown): 'red' | 'amber' | 'none' {
  if (isUrgent(notes)) return 'red'
  const d = daysUntil(deadlineOf(notes))
  if (d == null) return 'none'
  if (d <= 1) return 'red'
  if (d <= 3) return 'amber'
  return 'none'
}

export const RUS_DAYS = (n: number) => {
  const a = Math.abs(n) % 100, b = a % 10
  if (a > 10 && a < 20) return 'дней'
  if (b > 1 && b < 5) return 'дня'
  if (b === 1) return 'день'
  return 'дней'
}

// Человекочитаемо: «осталось 2 дня» / «сегодня» / «просрочка 1 день».
export function daysLeftLabel(deadline?: string | null): string | null {
  const d = daysUntil(deadline)
  if (d == null) return null
  if (d < 0) return `просрочка ${Math.abs(d)} ${RUS_DAYS(d)}`
  if (d === 0) return 'отгрузка сегодня'
  return `осталось ${d} ${RUS_DAYS(d)}`
}
