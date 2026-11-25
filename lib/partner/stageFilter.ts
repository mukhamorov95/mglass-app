import { PRODUCTION_STEPS } from '@/lib/partner/orderProgress'

// Фильтр «Заказов в работе» по статусам (Шовер Гласс 25.11). Название статуса — то же,
// что на карточке заказа; порядок — по ходу заказа через цех.

type Row = { lane: string; stage: string }

const ORDER = ['Отправлен в работу', ...PRODUCTION_STEPS.map(s => s.short), 'В работе', 'Готов к выдаче']
const rank = (s: string) => { const i = ORDER.indexOf(s); return i === -1 ? ORDER.length : i }

export const statusOf = (o: Row) => (o.lane === 'submitted' ? 'Отправлен в работу' : o.stage)

// Выбранный статус остаётся в ряду и с нулём: иначе после поиска его нечем снять.
export function statusChips(list: Row[], selected: string | null = null): { status: string; count: number }[] {
  const count = new Map<string, number>()
  for (const o of list) count.set(statusOf(o), (count.get(statusOf(o)) ?? 0) + 1)
  if (selected && !count.has(selected)) count.set(selected, 0)
  return [...count.entries()].map(([status, n]) => ({ status, count: n })).sort((a, b) => rank(a.status) - rank(b.status))
}
