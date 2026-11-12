import { OPEN_STATUSES } from './managerCascade'

// Отгрузка по изделиям (владелец 12.11.2026): уехавшая позиция не может стоять в цехе «закалка 0/5».
// Позиция, отгруженная целиком, закрывает свои открытые этапы каскадом с автором отгрузки; позиция,
// которую из отгрузки убрали, получает назад ровно то, что закрыл этот каскад. Позицию, уехавшую
// частично (2 из 4 шт.), не трогаем: задача у позиции одна на все штуки.

export const LINE_SHIPPED_FROM = 'shipping:line'

const OPEN = new Set<string>(OPEN_STATUSES)

export type LineTask = {
  id: number; item_index: number; stage_key: string; status: string
  auto_closed: boolean | null; auto_closed_from: string | null; completed_by: string | null
}

export function shippedLineIndexes(lines: { key: string; index: number; qty: number }[], shippedOf: (key: string) => number): Set<number> {
  return new Set(lines.filter(l => shippedOf(l.key) >= l.qty).map(l => l.index))
}

// Заказ с отметкой «Отгружен» держит закрытым всё: возвращать в очередь нечего.
export function pickLineTasks<T extends LineTask>(tasks: T[], shipped: Set<number>, orderShipped: boolean): { close: T[]; reopen: T[] } {
  const close = tasks.filter(t => OPEN.has(t.status) && shipped.has(t.item_index))
  const reopen = orderShipped ? [] : tasks.filter(t => t.status === 'done' && t.auto_closed === true && t.completed_by == null
    && t.auto_closed_from === LINE_SHIPPED_FROM && !shipped.has(t.item_index))
  return { close, reopen }
}
