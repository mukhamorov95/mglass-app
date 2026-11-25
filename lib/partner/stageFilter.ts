import { PRODUCTION_STEPS } from '@/lib/partner/orderProgress'

// Фильтр «Заказов в работе» по статусам (Шовер Гласс, владелец 25.11). Один ряд — весь путь
// заказа: этапы цеха → «Готов к выдаче» → «Отгружен». Этапы видны и с нулём: по ряду читается,
// где заказ может быть. Название этапа — то же, что на карточке заказа.

type Row = { lane: string; stage: string }

export const SHIPPED_STATUS = 'Отгружен'
const READY = 'Готов к выдаче'
// Постоянный ряд; «Чертёж», «Материал», «Отправлен в работу» — только когда такие заказы есть.
const ALWAYS = [...PRODUCTION_STEPS.filter(s => !s.legacy).map(s => s.short), READY]
const ORDER = ['Отправлен в работу', ...PRODUCTION_STEPS.map(s => s.short), 'В работе', READY]
const rank = (s: string) => { const i = ORDER.indexOf(s); return i === -1 ? ORDER.length : i }

export const statusOf = (o: Row) => (o.lane === 'submitted' ? 'Отправлен в работу' : o.lane === 'shipped' ? SHIPPED_STATUS : o.stage)

// Этапы заказов в работе по ходу цеха; «Отгружен» стоит отдельно в конце ряда.
export function statusChips(inWork: Row[]): { status: string; count: number }[] {
  const count = new Map<string, number>(ALWAYS.map(s => [s, 0]))
  for (const o of inWork) count.set(statusOf(o), (count.get(statusOf(o)) ?? 0) + 1)
  return [...count.entries()].map(([status, n]) => ({ status, count: n })).sort((a, b) => rank(a.status) - rank(b.status))
}
