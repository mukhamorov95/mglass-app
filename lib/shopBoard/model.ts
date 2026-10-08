import { PRODUCTION_STAGES } from '@/lib/productionStages'

// Табло цеха (docs/SHOP_BOARD_ROUTE.md): поручение по заказу, которое видят все.
// Здесь — правила без базы: кто что может, куда карточка переходит, как читается срок
// и прогресс заказа. Сервер, экран и тесты пользуются одними и теми же функциями.

export type CardStatus = 'new' | 'in_progress' | 'done' | 'closed'
export type CardAction = 'take' | 'done' | 'reopen' | 'close'

export type BoardCard = {
  id: number
  title: string
  details: string | null
  order_ids: number[]
  due_at: string | null
  hot: boolean
  status: CardStatus
  created_by: string
  created_by_name: string | null
  taken_by: string | null
  taken_by_name: string | null
  taken_at: string | null
  done_by: string | null
  done_by_name: string | null
  done_at: string | null
  closed_by: string | null
  closed_by_name: string | null
  closed_at: string | null
  created_at: string
}

export type BoardEvent = {
  id: number
  card_id: number
  kind: 'created' | 'taken' | 'done' | 'reopened' | 'closed' | 'comment'
  text: string | null
  by_name: string | null
  created_at: string
}

export const COLUMNS: { status: Exclude<CardStatus, 'closed'>; label: string }[] = [
  { status: 'new', label: 'Новые' },
  { status: 'in_progress', label: 'В работе' },
  { status: 'done', label: 'Готово' },
]

const OWNER = new Set(['admin', 'ceo'])
// Сотрудники. Партнёр, замерщик и внешние роли на табло не попадают даже с правом в permissions.
export const STAFF_ROLES = ['admin', 'ceo', 'manager', 'production', 'buyer', 'commercial', 'cfo', 'accountant', 'office', 'logist'] as const
const STAFF = new Set<string>(STAFF_ROLES)

// Ставят и двигают: владелец, весь цех, Дима (право shop_board) — решение владельца 08.10.
// Остальные сотрудники с доступом к экрану видят и пишут комментарии.
export function canCreateCard(role: string | null | undefined, permissions?: { shop_board?: boolean } | null): boolean {
  return OWNER.has(role ?? '') || role === 'production' || (STAFF.has(role ?? '') && permissions?.shop_board === true)
}

// Закрыть (убрать с табло) — тот, кто поставил, или владелец.
export function canCloseCard(card: Pick<BoardCard, 'created_by'>, userId: string | null, role: string | null | undefined): boolean {
  return OWNER.has(role ?? '') || (userId != null && card.created_by === userId)
}

// Куда переходит карточка. null — так нельзя (уже закрыта, уже взята и т. п.).
export function nextStatus(card: Pick<BoardCard, 'status' | 'taken_by'>, action: CardAction): CardStatus | null {
  const s = card.status
  if (action === 'take') return s === 'new' ? 'in_progress' : null
  if (action === 'done') return s === 'new' || s === 'in_progress' ? 'done' : null
  if (action === 'reopen') return s === 'done' || s === 'closed' ? (card.taken_by ? 'in_progress' : 'new') : null
  if (action === 'close') return s !== 'closed' ? 'closed' : null
  return null
}

export const ACTION_EVENT: Record<CardAction, BoardEvent['kind']> = {
  take: 'taken', done: 'done', reopen: 'reopened', close: 'closed',
}

const DAY = 86_400_000

export function isOverdue(card: Pick<BoardCard, 'due_at' | 'status'>, now: number): boolean {
  if (!card.due_at || card.status === 'done' || card.status === 'closed') return false
  return Date.parse(card.due_at) < now
}

// Горящие сверху, дальше сорванные, потом по сроку (без срока — в конце), потом по времени постановки.
export function sortCards<T extends Pick<BoardCard, 'hot' | 'due_at' | 'status' | 'created_at'>>(cards: T[], now: number): T[] {
  const due = (c: T) => (c.due_at ? Date.parse(c.due_at) : Infinity)
  return [...cards].sort((a, b) =>
    Number(b.hot) - Number(a.hot)
    || Number(isOverdue(b, now)) - Number(isOverdue(a, now))
    || due(a) - due(b)
    || Date.parse(a.created_at) - Date.parse(b.created_at))
}

// Дата и время по Москве — так говорят в цеху; база хранит момент (timestamptz).
const MSK = 3 * 3_600_000
const pad = (n: number) => String(n).padStart(2, '0')
function mskParts(ms: number) {
  const d = new Date(ms + MSK)
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() }
}

export function mskDateTime(iso: string): string {
  const p = mskParts(Date.parse(iso))
  return `${pad(p.d)}.${pad(p.mo)} ${pad(p.h)}:${pad(p.mi)}`
}

// «до 09.10 18:00», «сегодня до 18:00», «просрочено на 2 дн.» — то, что читают с экрана в цеху.
export function dueLabel(card: Pick<BoardCard, 'due_at' | 'status'>, now: number): string | null {
  if (!card.due_at) return null
  const at = Date.parse(card.due_at)
  const p = mskParts(at)
  const time = `${pad(p.h)}:${pad(p.mi)}`
  if (isOverdue(card, now)) {
    const late = now - at
    return late < DAY ? `сорван срок ${time}` : `просрочено на ${Math.floor(late / DAY)} дн.`
  }
  const today = mskParts(now)
  const sameDay = p.y === today.y && p.mo === today.mo && p.d === today.d
  return sameDay ? `сегодня до ${time}` : `до ${pad(p.d)}.${pad(p.mo)} ${time}`
}

// Срок из формы: дата 'YYYY-MM-DD' и время 'HH:MM' по Москве; без времени — конец смены, 18:00.
export function dueFromInput(date: string, time?: string | null): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const t = time && /^\d{2}:\d{2}$/.test(time) ? time : '18:00'
  const ms = Date.parse(`${date}T${t}:00+03:00`)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

export type CardInput = { title: string; details: string | null; order_ids: number[]; due_at: string | null; hot: boolean }

// Вход формы → карточка или ошибка словами (её покажут рядом с кнопкой).
export function parseCardInput(body: unknown): CardInput | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>
  const title = typeof b.title === 'string' ? b.title.trim() : ''
  if (!title) return { error: 'Напишите, что сделать' }
  if (title.length > 200) return { error: 'Слишком длинно — до 200 знаков, подробности ниже' }
  const detailsRaw = typeof b.details === 'string' ? b.details.trim() : ''
  if (detailsRaw.length > 2000) return { error: 'Подробности — до 2000 знаков' }
  const ids = Array.isArray(b.order_ids) ? b.order_ids : []
  const order_ids = [...new Set(ids.map(Number).filter(n => Number.isInteger(n) && n > 0))]
  if (order_ids.length > 10) return { error: 'Не больше 10 заказов в одном поручении' }
  let due_at: string | null = null
  if (b.due_at != null && b.due_at !== '') {
    const ms = typeof b.due_at === 'string' ? Date.parse(b.due_at) : NaN
    if (!Number.isFinite(ms)) return { error: 'Срок не распознан' }
    due_at = new Date(ms).toISOString()
  }
  return { title, details: detailsRaw || null, order_ids, due_at, hot: b.hot === true }
}

// Прогресс заказа по отметкам цеха: этап → закрыто из всего (по позициям). Порядок — как в цеху.
// at/by — последняя отметка этапа: «Резка ✓ 08.10 Никита» отвечает на «отрезан или нет».
export type StageProgress = { key: string; label: string; done: number; total: number; at?: string | null; by?: string | null }
export type TaskLite = { stage_key: string; status: string; completed_at?: string | null; completed_by_name?: string | null }

export function orderProgress(tasks: TaskLite[]): StageProgress[] {
  const by = new Map<string, { done: number; total: number; at: string | null; by: string | null }>()
  for (const t of tasks) {
    const a = by.get(t.stage_key) ?? { done: 0, total: 0, at: null, by: null }
    a.total++
    if (t.status === 'done') {
      a.done++
      if (t.completed_at && (!a.at || t.completed_at > a.at)) { a.at = t.completed_at; a.by = t.completed_by_name ?? null }
    }
    by.set(t.stage_key, a)
  }
  return PRODUCTION_STAGES
    .filter(s => by.has(s.key))
    .map(s => {
      const a = by.get(s.key)!
      return { key: s.key, label: s.label, done: a.done, total: a.total, ...(a.at ? { at: a.at, by: a.by } : {}) }
    })
}

// Ошибка «таблицы нет» — SQL табло ещё не применён: экран говорит об этом, а не падает.
export function isMissingTable(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false
  return error.code === '42P01' || error.code === 'PGRST205' || /could not find the table|does not exist/i.test(error.message ?? '')
}
