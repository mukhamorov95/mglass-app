// Фильтр ленты B2B-заказов: покупатель из списка, быстрые периоды и итог выборки
// «на какую сумму заказали» (владелец, 06.10). Чистые функции — ради тестов.

import { presetPeriod } from './clientReport'

export type DayPreset = 'today' | 'yesterday' | 'week' | 'month' | 'prev_month'

export const DAY_PRESETS: { id: DayPreset; label: string }[] = [
  { id: 'today', label: 'Сегодня' },
  { id: 'yesterday', label: 'Вчера' },
  { id: 'week', label: 'Неделя' },
  { id: 'month', label: 'Месяц' },
  { id: 'prev_month', label: 'Прошлый месяц' },
]

const shift = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

// «Неделя» — с понедельника по сегодня, «Месяц» — с первого числа по сегодня.
export function dayPresetRange(id: DayPreset, today: string): { from: string; to: string } {
  switch (id) {
    case 'today': return { from: today, to: today }
    case 'yesterday': { const y = shift(today, -1); return { from: y, to: y } }
    case 'week': {
      const dow = new Date(`${today}T00:00:00Z`).getUTCDay()
      return { from: shift(today, -((dow + 6) % 7)), to: today }
    }
    case 'month': return presetPeriod('month', today)
    case 'prev_month': return presetPeriod('prev_month', today)
  }
}

// Покупатель — карточка клиента. Старые заказы без карточки (client_id пуст) идут
// к карточке с тем же именем, если такая одна: иначе ShowerGlass стоял бы в списке
// дважды и делил сумму. Имя без карточки и имя двух карточек — отдельной строкой.
type ClientRef = { client_id: number | null; client_name: string }
const norm = (s: string) => s.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ')

export function clientKeyer(orders: ClientRef[]): (o: ClientRef) => string {
  const ids = new Map<string, Set<number>>()
  for (const o of orders) {
    if (o.client_id == null) continue
    const set = ids.get(norm(o.client_name)) ?? new Set<number>()
    set.add(o.client_id)
    ids.set(norm(o.client_name), set)
  }
  return o => {
    if (o.client_id != null) return `id:${o.client_id}`
    const set = ids.get(norm(o.client_name))
    return set?.size === 1 ? `id:${[...set][0]}` : `name:${norm(o.client_name)}`
  }
}

export type ClientOption = { key: string; label: string; count: number; clientId: number | null }

export function clientOptions(orders: ClientRef[], keyOf: (o: ClientRef) => string): ClientOption[] {
  const map = new Map<string, ClientOption>()
  for (const o of orders) {
    const key = keyOf(o)
    const cur = map.get(key) ?? { key, label: o.client_name.trim() || 'Без имени', count: 0, clientId: key.startsWith('id:') ? Number(key.slice(3)) : null }
    cur.count++
    map.set(key, cur)
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, 'ru'))
}

export type Bucket = { count: number; sum: number }
export type OrdersSummary = { all: Bucket; active: Bucket; shipped: Bucket; paid: Bucket; partial: Bucket; unpaid: Bucket }

// Итог выборки целиком — отгруженные тоже: «на какую сумму заказали» не зависит
// от того, на каком этапе заказ сейчас. «Не оплачено» — всё, где оплаты нет или
// о ней ничего не известно, чтобы три части сложились в итог.
export function summarizeOrders<T>(
  orders: T[],
  priceOf: (o: T) => number,
  shippedOf: (o: T) => boolean,
  payOf: (o: T) => 'paid' | 'partial' | 'unpaid' | 'unknown',
): OrdersSummary {
  const b = (): Bucket => ({ count: 0, sum: 0 })
  const s: OrdersSummary = { all: b(), active: b(), shipped: b(), paid: b(), partial: b(), unpaid: b() }
  const add = (x: Bucket, v: number) => { x.count++; x.sum += v }
  for (const o of orders) {
    const v = Math.round(priceOf(o))
    add(s.all, v)
    add(shippedOf(o) ? s.shipped : s.active, v)
    const p = payOf(o)
    add(p === 'paid' ? s.paid : p === 'partial' ? s.partial : s.unpaid, v)
  }
  return s
}
