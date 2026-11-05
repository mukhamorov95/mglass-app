// Табло «Заказы» (владелец 05.11.2026): все заказы цеха вкладками, просроченные сверху, срез на любую дату,
// кто и когда поставил каждый этап. Только расчёт, чтение из базы в маршруте.
import { overdueDays, type OrderShipState, type OrderStage } from '@/lib/production/clientShipments'
import { mskDayKey } from '@/lib/time'

export type BoardTab = 'in_work' | 'packed' | 'shipped' | 'overdue' | 'history'
export const BOARD_TABS: { key: BoardTab; label: string; hint: string; empty: string }[] = [
  { key: 'in_work', label: 'В работе', hint: 'Сверху просроченные, самые старые первыми. Цеху ещё есть что отмечать.', empty: 'Заказов в работе нет.' },
  { key: 'packed', label: 'Упакованы', hint: 'Все этапы закрыты, отметки об отгрузке нет. Старые, скорее всего, уже уехали: отметить их можно в разделе отгрузок со своей датой.', empty: 'Упакованных заказов нет.' },
  { key: 'shipped', label: 'Отгружены', hint: 'Заказы с отметкой об отгрузке. Свежие сверху.', empty: 'Отгруженных заказов нет.' },
  { key: 'overdue', label: 'Просроченные', hint: 'Срок прошёл, заказ ещё в работе. Самые старые сверху.', empty: 'Просроченных заказов нет.' },
  { key: 'history', label: 'История заказов', hint: 'Все заказы, свежие сверху.', empty: 'Заказов нет.' },
]
export const BOARD_TAB_KEYS: BoardTab[] = BOARD_TABS.map(t => t.key)

export type BoardTask = {
  item_index: number; stage_key: string; status: string; sequence_order: number
  completed_at: string | null; completed_by_name: string | null
  auto_closed?: boolean | null; auto_closed_by_name?: string | null; auto_closed_from?: string | null
}
export type BoardStageCount = { key: string; done: number; total: number }
export type BoardOrder = {
  id: number; no: string; client: string; client_id: number | null; urgent: boolean; paid: boolean; problem: boolean
  launch_day: string | null; deadline_day: string | null; overdue_days: number
  positions: number; pieces: number; weight: number; amount?: number
  stage: OrderStage; state: OrderShipState; shipped_pieces: number; ship_day: string | null
  stages: BoardStageCount[]; last_mark: { at: string; by: string | null } | null; idle_days: number | null
}

const dayKey = (iso: string) => mskDayKey(new Date(iso))
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000)

// Этап закрыт к концу дня to. Отметка ставится, когда её поставили, и позже этого дня её ещё не было.
export const doneBy = (t: BoardTask, to: string) => t.status === 'done' && !!t.completed_at && dayKey(t.completed_at) <= to

export function stageCounts(tasks: BoardTask[], to: string): BoardStageCount[] {
  const order = new Map<string, { seq: number; done: number; total: number }>()
  for (const t of tasks) {
    const cur = order.get(t.stage_key) ?? { seq: t.sequence_order, done: 0, total: 0 }
    cur.seq = Math.min(cur.seq, t.sequence_order)
    cur.total++
    if (doneBy(t, to)) cur.done++
    order.set(t.stage_key, cur)
  }
  return [...order.entries()].sort((a, b) => a[1].seq - b[1].seq).map(([key, v]) => ({ key, done: v.done, total: v.total }))
}

export const lastMarkOf = (tasks: BoardTask[], to: string) => {
  const done = tasks.filter(t => doneBy(t, to)).sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))[0]
  return done?.completed_at ? { at: done.completed_at, by: done.completed_by_name ?? done.auto_closed_by_name ?? null } : null
}

// Вкладка по отметкам. Упакован значит «цеху отмечать нечего»: у части позиций нет этапа упаковки, и счёт только по ней оставил бы их в работе навсегда.
export function boardStage(tasks: BoardTask[], to: string, shipped: boolean): OrderStage {
  if (shipped) return 'shipped'
  return tasks.length > 0 && tasks.every(t => doneBy(t, to)) ? 'packed' : 'in_work'
}

// Просрочка только у заказа в работе: у упакованных старых она утопила бы настоящие (на 05.11 их 350 против 104 в работе).
export const boardOverdue = (deadlineDay: string | null, to: string, stage: OrderStage) => (stage === 'in_work' ? overdueDays(deadlineDay, to, stage) : 0)

export function inBoardTab(o: Pick<BoardOrder, 'stage' | 'overdue_days' | 'ship_day' | 'launch_day'>, tab: BoardTab, period: { from: string; to: string } | null): boolean {
  if (tab === 'overdue') return o.overdue_days > 0
  if (tab === 'in_work' || tab === 'packed') return o.stage === tab
  if (tab === 'shipped') return o.stage === 'shipped' && (!period || (!!o.ship_day && o.ship_day >= period.from && o.ship_day <= period.to))
  return !period || (!!o.launch_day && o.launch_day >= period.from && o.launch_day <= period.to)
}

export function boardSort<T extends Pick<BoardOrder, 'id' | 'urgent' | 'overdue_days' | 'deadline_day' | 'launch_day' | 'ship_day'>>(list: T[], tab: BoardTab, isPoint: (o: T) => boolean): T[] {
  const newestFirst = tab === 'shipped' || tab === 'history'
  return [...list].sort((a, b) => {
    if (newestFirst) {
      const ka = (tab === 'shipped' ? a.ship_day : a.launch_day) ?? ''
      const kb = (tab === 'shipped' ? b.ship_day : b.launch_day) ?? ''
      return kb.localeCompare(ka) || b.id - a.id
    }
    // Просроченные выше всех, внутри своей группы срочные, затем точки (решение 01.10).
    const late = Number(b.overdue_days > 0) - Number(a.overdue_days > 0)
    if (late) return late
    const urgent = Number(b.urgent) - Number(a.urgent)
    if (urgent) return urgent
    const point = Number(isPoint(b)) - Number(isPoint(a))
    if (point) return point
    if (a.overdue_days !== b.overdue_days) return b.overdue_days - a.overdue_days
    return (a.deadline_day ?? '9').localeCompare(b.deadline_day ?? '9') || a.id - b.id
  })
}

// Что написать у закрытого этапа. Автозакрытый этап человек отдельно не отмечал: так и говорим.
export function markLine(t: BoardTask, stageLabel: (key: string) => string): { by: string | null; note: string | null } {
  if (!t.auto_closed) return { by: t.completed_by_name, note: null }
  const from = t.auto_closed_from ?? ''
  const note = from === 'manager:shipped' ? 'закрыт отметкой «Отгружен»'
    : from.startsWith('manager:') ? 'закрыт отметкой на заказе'
    : from ? `закрыт вместе с этапом «${stageLabel(from)}»` : 'закрыт автоматически'
  return { by: t.auto_closed_by_name ?? t.completed_by_name, note }
}

export const idleDays = (last: { at: string } | null, launchDay: string | null, to: string) => {
  const since = last ? dayKey(last.at) : launchDay
  return since ? Math.max(0, daysBetween(since, to)) : null
}
