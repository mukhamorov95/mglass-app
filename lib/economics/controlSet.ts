import type { OrderRow } from './facts/items'

// Контрольный набор маршрута: запущенные неархивные заказы 01–26.11.2026 из замороженного снимка.
// Только для офлайн-отчётов; расширять выборку без решения владельца нельзя.
export const CONTROL_FROM = '2026-11-01'
export const CONTROL_TO = '2026-11-26'

export type ControlRow = OrderRow & { launched_at: string | null; archived_at: string | null }

export const controlSet = <T extends ControlRow>(orders: T[]) => orders.filter(o =>
  !o.archived_at && !!o.launched_at && o.launched_at >= CONTROL_FROM && o.launched_at.slice(0, 10) <= CONTROL_TO)
