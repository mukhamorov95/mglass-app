// Счёт как запись: помощники регистрации счёта в invoices.
//
// Ключ идемпотентности — НАБОР заказов (order_ids), не номер счёта: менеджер
// номер правит, а набор заказов у одного счёта неизменен. Один набор = один счёт.

// Канонический ключ набора заказов: уникальные положительные id по возрастанию.
// От порядка выбора и повторов не зависит — один набор всегда даёт один ключ.
export function canonicalOrderIds(raw: unknown): number[] {
  const set = new Set((Array.isArray(raw) ? raw : []).map(Number).filter(n => Number.isFinite(n) && n > 0))
  return [...set].sort((a, b) => a - b)
}

export function orderSetKey(raw: unknown): string {
  return canonicalOrderIds(raw).join(',')
}

// Тот же ли это набор заказов (независимо от порядка и дублей во входе).
export function sameOrderSet(a: unknown, b: unknown): boolean {
  return orderSetKey(a) === orderSetKey(b)
}
