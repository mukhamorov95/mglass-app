import { SHOWER_GLASS } from '@/lib/production/clientShipments'
import { mskDayKey } from '@/lib/time'

// Заказы клиента, запущенные раньше даты, закрыты по слову владельца: оплат тех месяцев
// в приложении нет, и без границы такие заказы показывали долг, которого нет.
// Шовер Гласс: акт бухгалтера начат с 01.07.2026, всё до него оплачено (владелец 05.11).
const SETTLED_BEFORE: Record<number, string> = { [SHOWER_GLASS.clientId]: '2026-07-01' }

export const settledBeforeOf = (clientId: number | null | undefined): string | null =>
  clientId == null ? null : SETTLED_BEFORE[clientId] ?? null

export function launchDayOf(launchedAt: unknown, notes: Record<string, unknown>): string | null {
  const v = launchedAt ?? notes.launched_at
  if (typeof v !== 'string' || !v.trim()) return null
  const t = new Date(v)
  return Number.isNaN(t.getTime()) ? null : mskDayKey(t)
}

export function isSettledOrder(clientId: number | null | undefined, launchedAt: unknown, notes: Record<string, unknown>): boolean {
  const before = settledBeforeOf(clientId)
  const day = before ? launchDayOf(launchedAt, notes) : null
  return !!before && !!day && day < before
}
