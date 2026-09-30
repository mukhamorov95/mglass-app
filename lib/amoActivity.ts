// Рабочий день менеджеров по AmoCRM: первое и последнее действие, сообщения, звонки,
// закрытые задачи. Чистые функции — данные из API собирает lib/amoActivityFetch.ts.
//
// Две ловушки, на которых человек выглядит неработающим, хотя работает:
// 1) Больше половины исходящих сообщений приходит в amo без автора (created_by = 0) —
//    их отправили с телефона или из приложения Wazzup, минуя интерфейс amo. Такие
//    сообщения засчитываем ответственному по сделке, но отдельной колонкой: кто
//    нажал «отправить», amo не знает.
// 2) Пропущенный входящий amo пишет событием incoming_call под именем менеджера.
//    Это не его действие — отличаем по заметке звонка (call_status 4 = разговор был).
// И одна, на которой человек выглядит быстрее, чем есть: автоответ Wazzup и Salesbot и
// ИИ-продавец Авито — тоже исходящее без автора (см. dropAutoReplies).

export type AmoActivityEvent = {
  type: string
  entity_id: number
  entity_type: string
  created_by: number
  created_at: number
  value_after?: Array<{ note?: { id: number }; message?: { talk_id?: number; origin?: string } }> | null
}

export type AmoCallNote = {
  id: number
  note_type: string | number
  created_by: number
  created_at: number
  params?: { duration?: number; call_status?: number | null } | null
}

export type DayActivity = {
  day: string
  firstAt: number | null
  lastAt: number | null
  activeHours: number
  longestPauseMin: number
  actions: number
  hourly: number[]
  hourlyNoAuthor: number[]
  messagesOwn: number
  messagesNoAuthor: number
  clientMessages: number
  tasksCompleted: number
  tasksPostponed: number
  cardsMoved: number
  callsOut: number
  callsOutConnected: number
  callsInAnswered: number
  callsInMissed: number
  talkSeconds: number
  replyMinutes: number[]
  unanswered: number
  leftWaiting: number
}

export type CountKey =
  | 'actions' | 'messagesOwn' | 'messagesNoAuthor' | 'clientMessages' | 'tasksCompleted'
  | 'tasksPostponed' | 'cardsMoved' | 'callsOut' | 'callsOutConnected' | 'callsInAnswered'
  | 'callsInMissed' | 'talkSeconds' | 'unanswered' | 'leftWaiting'

export const COUNT_KEYS: CountKey[] = [
  'actions', 'messagesOwn', 'messagesNoAuthor', 'clientMessages', 'tasksCompleted',
  'tasksPostponed', 'cardsMoved', 'callsOut', 'callsOutConnected', 'callsInAnswered',
  'callsInMissed', 'talkSeconds', 'unanswered', 'leftWaiting',
]

export type ManagerActivity = {
  userId: number
  name: string
  days: DayActivity[]
  total: Record<CountKey, number>
  workDays: number
  medianStartMin: number | null
  medianEndMin: number | null
  avgActiveHours: number
  medianReplyMin: number | null
  repliesCounted: number
}

export type AmoActivityReport = {
  from: number
  to: number
  days: string[]
  managers: ManagerActivity[]
  noAuthorUnassigned: number
  autoReplies: number
}

const MSK = 3 * 3600
const CALL_CONNECTED = 4
// Ответ клиенту меряем только на сообщениях, пришедших днём: ночное «ответили в 9:30»
// — это не медленный менеджер.
const REPLY_WINDOW = { fromHour: 9, toHour: 19 }
const LEFT_WAITING_UNTIL = 21

// Не действия человека: сообщения клиента, системные отметки о беседах и связки
// сделка↔контакт — их ставит интеграция заявок под учёткой менеджера, в том числе
// в 2–5 часов ночи, и «первое действие» съезжало бы на ночь.
const NOT_OWN_ACTION = new Set([
  'incoming_chat_message', 'talk_missed_event', 'link_followed', 'talk_created',
  'entity_linked', 'entity_unlinked',
])

// Что считается действием человека — одно правило на счётчик в таблице и на ленту
// «что именно он делал» (lib/amoTimeline.ts): иначе число и список разойдутся.
export function isOwnAction(e: AmoActivityEvent, missedCallNoteIds: Set<number>): boolean {
  if (!e.created_by || NOT_OWN_ACTION.has(e.type)) return false
  if (e.type === 'incoming_call' && missedCallNoteIds.has(e.value_after?.[0]?.note?.id ?? -1)) return false
  return true
}

// Заметки о непринятых входящих: их события amo пишет на менеджера, но это не его действие
export function missedCallNoteIds(notes: AmoCallNote[]): Set<number> {
  const out = new Set<number>()
  for (const n of notes) if (n.created_by && callKind(n) === 'in_missed') out.add(n.id)
  return out
}

export const mskDay = (ts: number) => new Date((ts + MSK) * 1000).toISOString().slice(0, 10)
export const mskHour = (ts: number) => new Date((ts + MSK) * 1000).getUTCHours()
export const mskMinuteOfDay = (ts: number) => Math.floor(((ts + MSK) % 86400) / 60)
export const mskDayStart = (day: string) => Date.parse(`${day}T00:00:00Z`) / 1000 - MSK

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

export function callKind(note: AmoCallNote): 'out_ok' | 'out_fail' | 'in_ok' | 'in_missed' | null {
  const t = String(note.note_type)
  const ok = Number(note.params?.call_status) === CALL_CONNECTED
  if (t === 'call_out') return ok ? 'out_ok' : 'out_fail'
  if (t === 'call_in') return ok ? 'in_ok' : 'in_missed'
  return null
}

const isChat = (e: AmoActivityEvent) =>
  e.type === 'incoming_chat_message' || e.type === 'outgoing_chat_message'

// Робот — не ответ и не касание: иначе «ответили через 0 мин», а клиент, которому ответил только
// робот, выпадает из «ждёт ответа». Одно правило на «Активность», «Мой день», «Результат»,
// пропущенные и разбор дня. В amo робот пишет без автора, как менеджер с телефона, и узнаётся так:
// 1) приветствие Wazzup и Salesbot — не позже AUTO_REPLY_SEC после создания сделки или после
//    сообщения клиента, которое открывает беседу (первое в ней или первое после часа тишины).
//    Быстрое исходящее без автора посреди переписки — человек с телефона: по журналу Wazzup
//    23–29.09 все 15 опознанных такие ответы — менеджеры;
// 2) ИИ-продавец Авито «Иван» — по его журналу (lib/botReplies.ts): в amo его сообщение стоит не
//    дальше BOT_MATCH_SEC от записи «БОТ: …» (02–17.09: 703 из 704; у сообщений с автором — 3 из
//    1045). Владелец 30.09: менеджеру не засчитывать. Прочее без автора в Авито — менеджер из
//    приложения Авито.
export const AUTO_REPLY_SEC = 30
export const TALK_PAUSE_SEC = 3600
export const BOT_MATCH_SEC = 1.5

export type RobotTrace = { leadCreatedAt: Map<number, number>; botSentAt: number[] }

const isAvito = (e: AmoActivityEvent) => !!e.value_after?.[0]?.message?.origin?.startsWith('avito')

// Может ли сообщение оказаться автоответом по времени — по нему же сбор решает, где нужны входящие
export const mayBeAutoReply = (e: AmoActivityEvent) =>
  e.type === 'outgoing_chat_message' && !e.created_by && !isAvito(e)

function hasNear(sorted: number[], t: number, tol: number): boolean {
  let lo = 0, hi = sorted.length
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < t - tol) lo = mid + 1; else hi = mid }
  return lo < sorted.length && sorted[lo] <= t + tol
}

export function dropAutoReplies<E extends AmoActivityEvent>(events: E[], robots: RobotTrace): E[] {
  const { leadCreatedAt } = robots
  const botSentAt = [...robots.botSentAt].sort((a, b) => a - b)
  const byTalk = new Map<number, E[]>()
  for (const e of events) {
    const talk = e.value_after?.[0]?.message?.talk_id
    if (!isChat(e) || !talk) continue
    const list = byTalk.get(talk) ?? []
    list.push(e)
    byTalk.set(talk, list)
  }
  const openers = new Map<number, number[]>()
  for (const [talk, list] of byTalk) {
    list.sort((a, b) => a.created_at - b.created_at)
    // паузу меряем до событий прошлых секунд: автоответ в ту же секунду amo отдаёт то раньше, то позже
    let prev: number | null = null, cur: number | null = null
    const opens: number[] = []
    for (const m of list) {
      if (m.created_at !== cur) { prev = cur; cur = m.created_at }
      if (m.type === 'incoming_chat_message' && (prev === null || m.created_at - prev >= TALK_PAUSE_SEC)) opens.push(m.created_at)
    }
    openers.set(talk, opens)
  }
  const soonAfter = (t: number, from: number | undefined) => from !== undefined && t >= from && t - from <= AUTO_REPLY_SEC
  return events.filter(e => {
    if (e.type !== 'outgoing_chat_message' || e.created_by) return true
    if (isAvito(e)) return !hasNear(botSentAt, e.created_at, BOT_MATCH_SEC)
    const msg = e.value_after?.[0]?.message
    if (e.entity_type === 'lead' && soonAfter(e.created_at, leadCreatedAt.get(e.entity_id))) return false
    return !(msg?.talk_id && (openers.get(msg.talk_id) ?? []).some(t => soonAfter(e.created_at, t)))
  })
}

// Ожидание ответа: клиент написал после нашего сообщения (или первым) — ждёт до
// первого исходящего в этой беседе, от кого бы оно ни пришло. Автоответы убирает
// вызывающий (dropAutoReplies) — ему нужна дата создания сделки.
export function replyEpisodes(events: AmoActivityEvent[]) {
  const byTalk = new Map<number, AmoActivityEvent[]>()
  for (const e of events) {
    const talk = e.value_after?.[0]?.message?.talk_id
    if (!isChat(e) || !talk) continue
    const list = byTalk.get(talk) ?? []
    list.push(e)
    byTalk.set(talk, list)
  }
  const out: { leadId: number | null; startAt: number; replyAt: number | null }[] = []
  for (const list of byTalk.values()) {
    list.sort((a, b) => a.created_at - b.created_at)
    let start: AmoActivityEvent | null = null
    for (const m of list) {
      if (m.type === 'incoming_chat_message') {
        if (!start) start = m
      } else if (start) {
        out.push({ leadId: start.entity_type === 'lead' ? start.entity_id : null, startAt: start.created_at, replyAt: m.created_at })
        start = null
      }
    }
    if (start) out.push({ leadId: start.entity_type === 'lead' ? start.entity_id : null, startAt: start.created_at, replyAt: null })
  }
  return out
}

export function emptyDay(day: string): DayActivity {
  return {
    day, firstAt: null, lastAt: null, activeHours: 0, longestPauseMin: 0, actions: 0,
    hourly: Array(24).fill(0), hourlyNoAuthor: Array(24).fill(0),
    messagesOwn: 0, messagesNoAuthor: 0, clientMessages: 0, tasksCompleted: 0, tasksPostponed: 0,
    cardsMoved: 0, callsOut: 0, callsOutConnected: 0, callsInAnswered: 0, callsInMissed: 0,
    talkSeconds: 0, replyMinutes: [], unanswered: 0, leftWaiting: 0,
  }
}

export function periodDays(from: number, to: number): string[] {
  const days: string[] = []
  for (let t = from; t < to; t += 86400) days.push(mskDay(t))
  return days
}

export function buildAmoActivity(input: {
  from: number
  to: number
  users: { id: number; name: string }[]
  events: AmoActivityEvent[]
  callNotes: AmoCallNote[]
  leadResponsible: Map<number, number>
  robots: RobotTrace
}): AmoActivityReport {
  const { from, to, users } = input
  const inRange = (ts: number) => ts >= from && ts < to
  const events = dropAutoReplies(input.events, input.robots).filter(e => inRange(e.created_at))
  const autoReplies = input.events.filter(e => inRange(e.created_at)).length - events.length
  const notes = input.callNotes.filter(n => inRange(n.created_at))
  const days = periodDays(from, to)

  const grid = new Map<number, Map<string, DayActivity>>()
  const cell = (userId: number, ts: number) => {
    let byDay = grid.get(userId)
    if (!byDay) { byDay = new Map(days.map(d => [d, emptyDay(d)])); grid.set(userId, byDay) }
    const day = mskDay(ts)
    let c = byDay.get(day)
    if (!c) { c = emptyDay(day); byDay.set(day, c) }
    return c
  }
  const actionTimes = new Map<number, number[]>()
  const addAction = (userId: number, ts: number) => {
    const c = cell(userId, ts)
    c.actions++
    c.hourly[mskHour(ts)]++
    const list = actionTimes.get(userId) ?? []
    list.push(ts)
    actionTimes.set(userId, list)
  }

  const missedCallNotes = new Set<number>()
  for (const n of notes) {
    if (!n.created_by) continue
    const kind = callKind(n)
    if (!kind) continue
    const c = cell(n.created_by, n.created_at)
    if (kind === 'out_ok' || kind === 'out_fail') c.callsOut++
    if (kind === 'out_ok') c.callsOutConnected++
    if (kind === 'in_ok') c.callsInAnswered++
    if (kind === 'in_missed') { c.callsInMissed++; missedCallNotes.add(n.id) }
    if (kind === 'out_ok' || kind === 'in_ok') c.talkSeconds += n.params?.duration ?? 0
  }

  let noAuthorUnassigned = 0
  for (const e of events) {
    if (e.type === 'outgoing_chat_message' && !e.created_by) {
      const owner = e.entity_type === 'lead' ? input.leadResponsible.get(e.entity_id) : undefined
      if (!owner) { noAuthorUnassigned++; continue }
      const c = cell(owner, e.created_at)
      c.messagesNoAuthor++
      c.hourlyNoAuthor[mskHour(e.created_at)]++
      continue
    }
    if (e.type === 'incoming_chat_message') {
      const owner = e.entity_type === 'lead' ? input.leadResponsible.get(e.entity_id) : undefined
      if (owner) cell(owner, e.created_at).clientMessages++
      continue
    }
    if (!isOwnAction(e, missedCallNotes)) continue
    const c = cell(e.created_by, e.created_at)
    if (e.type === 'outgoing_chat_message') c.messagesOwn++
    if (e.type === 'task_completed') c.tasksCompleted++
    if (e.type === 'task_deadline_changed') c.tasksPostponed++
    if (e.type === 'lead_status_changed') c.cardsMoved++
    addAction(e.created_by, e.created_at)
  }

  for (const [userId, times] of actionTimes) {
    times.sort((a, b) => a - b)
    const byDay = grid.get(userId)!
    for (const ts of times) {
      const c = byDay.get(mskDay(ts))!
      if (c.lastAt !== null) c.longestPauseMin = Math.max(c.longestPauseMin, Math.floor((ts - c.lastAt) / 60))
      if (c.firstAt === null) c.firstAt = ts
      c.lastAt = ts
    }
  }

  for (const ep of replyEpisodes(events)) {
    const owner = ep.leadId ? input.leadResponsible.get(ep.leadId) : undefined
    if (!owner) continue
    const c = cell(owner, ep.startAt)
    const h = mskHour(ep.startAt)
    // Клиент написал в будний вечер после последнего действия ответственного и не получил ответа
    // до 21:00 — ждал до утра. Считаем по его сделкам, от кого бы ни был ответ.
    const wd = new Date((ep.startAt + MSK) * 1000).getUTCDay()
    const evening = mskDayStart(mskDay(ep.startAt)) + LEFT_WAITING_UNTIL * 3600
    if (wd >= 1 && wd <= 5 && h < LEFT_WAITING_UNTIL && c.lastAt !== null && ep.startAt > c.lastAt
      && (ep.replyAt === null || ep.replyAt > evening)) c.leftWaiting++
    if (h < REPLY_WINDOW.fromHour || h >= REPLY_WINDOW.toHour) continue
    if (ep.replyAt === null) c.unanswered++
    else c.replyMinutes.push(Math.round((ep.replyAt - ep.startAt) / 60))
  }

  const names = new Map(users.map(u => [u.id, u.name]))
  const managers: ManagerActivity[] = [...grid.entries()].map(([userId, byDay]) => {
    const list = days.map(d => byDay.get(d)!)
    for (const c of list) c.activeHours = c.hourly.filter(n => n > 0).length
    const total = Object.fromEntries(COUNT_KEYS.map(k => [k, list.reduce((s, c) => s + c[k], 0)])) as Record<CountKey, number>
    const worked = list.filter(c => c.actions > 0)
    const replies = list.flatMap(c => c.replyMinutes)
    return {
      userId,
      name: names.get(userId) ?? `amo #${userId}`,
      days: list,
      total,
      workDays: worked.length,
      medianStartMin: median(worked.map(c => mskMinuteOfDay(c.firstAt!))),
      medianEndMin: median(worked.map(c => mskMinuteOfDay(c.lastAt!))),
      avgActiveHours: worked.length ? Math.round((worked.reduce((s, c) => s + c.activeHours, 0) / worked.length) * 10) / 10 : 0,
      medianReplyMin: median(replies),
      repliesCounted: replies.length,
    }
  })
  managers.sort((a, b) => b.total.actions - a.total.actions)
  return { from, to, days, managers, noAuthorUnassigned, autoReplies }
}

export const fmtMinuteOfDay = (m: number | null) =>
  m === null ? '—' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

export const fmtTime = (ts: number | null) => (ts === null ? '—' : fmtMinuteOfDay(mskMinuteOfDay(ts)))
