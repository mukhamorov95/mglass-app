// «Упаковано сегодня» и «Отгружено сегодня» — списки для вечернего отчёта в Telegram.
//
// Никита вечером набирает номера заказов в столбик руками, хотя сам же отмечал
// упаковку и отгрузку в приложении. Здесь собирается ровно тот текст, который он
// печатает, — чтобы он его скопировал и вставил, а не перенабирал.
//
// Автоотправки нет сознательно: человек видит текст перед отправкой в группу.

import { mskDayKey } from '@/lib/time'

export type DayOrder = {
  id:         number
  number:     string
  client:     string
  packagedAt: unknown
  shippedAt:  unknown
}

// Отметки этапов лежат в notes.stages в трёх видах сразу, и это не грязь, а история:
//   • `true`  — 3788 старых отгрузок без даты. День восстановить неоткуда;
//   • `2026-09-01` — так пишет экран заказов менеджера;
//   • `2026-09-02T10:55:12.062Z` — так пишет отметка «Отгружен» в цеху.
// Полную метку обязательно приводим к московскому дню: отгрузка в 01:30 по Москве
// это 22:30 предыдущих суток по UTC, и заказ уехал бы во вчерашний список.
export function stageDayKey(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const s = value.trim()
  if (!s || s === 'true') return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const t = Date.parse(s)
  if (Number.isNaN(t)) return null
  return mskDayKey(t)
}

export function packedOn(orders: DayOrder[], dayKey: string): DayOrder[] {
  return orders.filter(o => stageDayKey(o.packagedAt) === dayKey).sort((a, b) => a.id - b.id)
}

export function shippedOn(orders: DayOrder[], dayKey: string): DayOrder[] {
  return orders.filter(o => stageDayKey(o.shippedAt) === dayKey).sort((a, b) => a.id - b.id)
}

// Сколько штук по заказу ещё не упаковано. null — если считать не из чего
// (задач упаковки нет вовсе): пустая строка честнее нуля, который читался бы
// как «всё упаковано».
export function unpackedPieces(
  tasks: { item_index: number; station: string; status: string }[],
  quantities: Map<number, number>,
): number | null {
  const pack = tasks.filter(t => t.station === 'packaging')
  if (pack.length === 0) return null
  return pack
    .filter(t => t.status !== 'done')
    .reduce((sum, t) => sum + Math.max(1, quantities.get(t.item_index) ?? 1), 0)
}

// Текст для вставки в группу: номер с новой строки, ничего лишнего.
//
// Хвост в скобках — только там, где остаток ЕСТЬ В ДАННЫХ. Для упаковки это
// неупакованные штуки. Для отгрузки остатка не существует: `shipped` — отметка
// на весь заказ, частичной отгрузки система не хранит, и «( осталось 2 штуки)»
// у Никиты в группе — его знание, а не наше. Выдумывать его нельзя: цифра в
// отчёте клиенту дороже пустого места.
export function copyList(rows: { number: string; remaining?: number | null }[]): string {
  return rows
    .map(r => (r.remaining && r.remaining > 0 ? `${r.number}( осталось ${r.remaining} шт)` : r.number))
    .join('\n')
}

// «3 заказ(ов)» в цеху читается как недоделка, а список видят каждый вечер.
export function ordersCount(n: number): string {
  const d10 = n % 10, d100 = n % 100
  if (d10 === 1 && d100 !== 11) return `${n} заказ`
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return `${n} заказа`
  return `${n} заказов`
}
