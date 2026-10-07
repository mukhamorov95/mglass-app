import { PRODUCTION_STAGES } from '@/lib/productionStages'

// Отметка заказа «упакован/отгружен» мимо цеха закрывает его открытые задачи.
//
// Вторая точка записи этапов — менеджер в «Заказах B2B» (и цех на экране «Отгрузка»):
// заказ уехал, а его задачи висели в очередях. На 07.10 таких открытых было 339 по
// заказам, запущенным больше месяца назад, — очередь цеха перестала быть реальной
// работой, и её перестали смотреть.
//
// Закрываем как каскад (auto_closed), без исполнителя: этапы физически пройдены, но
// никто из цеха их не отмечал — приписать их рабочему значит исказить выработку.
// Снятие отметки задачи НЕ переоткрывает: снятие — исправление в учёте заказа, а
// пройденная работа от него не исчезает.

export type OrderMark = 'packaged' | 'shipped'

export type OpenTask = { id: number; stage_key: string; status: string }

export const OPEN_STATUSES = ['queued', 'in_progress', 'problem'] as const
const OPEN = new Set<string>(OPEN_STATUSES)

const ORDER: string[] = PRODUCTION_STAGES.map(s => s.key)
const PACKAGING = ORDER.indexOf('packaging')

// Отгружен — значит и упакован: при обеих отметках в одном запросе берём отгрузку.
// Пустое значение (снятие отметки) — не повод ничего закрывать.
export function orderMarkOf(stages: Record<string, unknown>): OrderMark | null {
  const set = (v: unknown) => (typeof v === 'string' && v.trim() !== '') || v === true
  if (set(stages.shipped)) return 'shipped'
  if (set(stages.packaged)) return 'packaged'
  return null
}

// Отгрузка закрывает всё открытое. Упаковка — этапы до упаковки включительно: упаковка
// последняя в маршруте, но если после неё появится этап, упакованный заказ его не проходил.
export function pickTasksToClose<T extends OpenTask>(tasks: T[], mark: OrderMark): T[] {
  return tasks.filter(t => {
    if (!OPEN.has(t.status)) return false
    if (mark === 'shipped') return true
    const i = ORDER.indexOf(t.stage_key)
    return i !== -1 && i <= PACKAGING
  })
}

// Откуда пришло закрытие — в auto_closed_from рядом с этапами цеха ('packaging' и т.п.),
// поэтому с явной приставкой: отчёт о каскаде отличит отметку менеджера от отметки станции.
export const CASCADE_FROM = {
  manager: { packaged: 'manager:packaged', shipped: 'manager:shipped' },
  shipping: { packaged: 'shipping:packaged', shipped: 'shipping:shipped' },
} as const satisfies Record<string, Record<OrderMark, string>>
