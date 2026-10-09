import { mskDay, mskMinuteOfDay } from '@/lib/amoActivity'

// Кому отдать новую заявку «Продаж» (docs/LEAD_DISTRIBUTION_ROUTE.md). Только правила, без запросов —
// сбор в lib/leadDistribution/collect.ts. Одинаково в тени и вживую: тень ничего не пишет в amo,
// но решает теми же правилами, иначе неделя сравнения ничего не докажет.

// Пороги перегруза — с какого числа менеджер не получает новых. Сняты с живой загрузки 30.09 12:50:
// ждут ответа у Яны 3, Айжан 4, Семёна 2, Александры 8. При «3» перегружены все на смене и очереди нет;
// при «6» не получает только тот, у кого хвост заметно больше, чем у всех.
export const WAITING_MAX = 6      // клиентов ждут ответа
export const MISSED_MAX = 3       // пропущенных без перезвона
export const UNTOUCHED_MAX = 3    // новых заявок без касания
export const ABSENT_AFTER_MIN = 60 // час смены без единого действия в amo — «нет на месте»
export const KNOWN_FRESH_SEC = 24 * 3600 // ответственный у сделки младше суток — ещё не выбор человека, а умолчание АТС

const DEFAULT_FROM = '09:00'
const DEFAULT_TO = '18:00'
const SATURDAY = 6

export type Seller = {
  id: number
  name: string
  startsOn: string | null
  workFrom: string | null
  workTo: string | null
  workDays: number[]      // 1 = пн … 7 = вс
}

export type Load = { waiting: number; missed: number; untouched: number }

export type SellerState = {
  id: number
  name: string
  onShift: boolean
  offReason: string | null
  load: Load
  todayCount: number
  lastAssignedAt: number | null
}

export type Decision =
  | { status: 'decided'; rule: 'known_client' | 'rotation' | 'least_loaded'; userId: number; name: string; reason: string; allOverloaded: boolean }
  | { status: 'deferred'; reason: string }

const toMin = (t: string | null, fallback: string) => {
  const [h, m] = (t ?? fallback).split(':').map(Number)
  return h * 60 + (m || 0)
}
const isoWeekday = (ts: number) => new Date((ts + 3 * 3600) * 1000).getUTCDay() || 7

// На смене ли продавец сейчас. firstActionToday — первое собственное действие в amo за сегодня.
export function shiftState(s: Seller, now: number, firstActionToday: number | null): { onShift: boolean; why: string | null } {
  const today = mskDay(now)
  if (s.startsOn && today < s.startsOn) return { onShift: false, why: 'ещё не вышел на работу' }
  const wd = isoWeekday(now)
  if (wd === SATURDAY && !s.workDays.includes(SATURDAY)) {
    return firstActionToday !== null ? { onShift: true, why: null } : { onShift: false, why: 'суббота, не дежурит' }
  }
  if (!s.workDays.includes(wd)) return { onShift: false, why: 'выходной по графику' }
  const nowMin = mskMinuteOfDay(now)
  const from = toMin(s.workFrom, DEFAULT_FROM)
  if (nowMin < from || nowMin >= toMin(s.workTo, DEFAULT_TO)) return { onShift: false, why: 'вне смены' }
  if (firstActionToday === null && nowMin >= from + ABSENT_AFTER_MIN) return { onShift: false, why: 'нет в amo с начала смены' }
  return { onShift: true, why: null }
}

export function overload(l: Load): string[] {
  const out: string[] = []
  if (l.waiting >= WAITING_MAX) out.push(`${l.waiting} клиент(а) ждут ответа`)
  if (l.missed >= MISSED_MAX) out.push(`${l.missed} пропущенных без перезвона`)
  if (l.untouched >= UNTOUCHED_MAX) out.push(`${l.untouched} новых заявок без касания`)
  return out
}

const loadSum = (l: Load) => l.waiting + l.missed + l.untouched

// Справедливость: меньше заявок за сегодня; при равенстве — кто дольше не получал; дальше — стабильно по id
function fairest(list: SellerState[]): SellerState {
  return [...list].sort((a, b) =>
    a.todayCount - b.todayCount
    || (a.lastAssignedAt ?? 0) - (b.lastAssignedAt ?? 0)
    || a.id - b.id)[0]
}

export function decide(input: { known: { userId: number; name: string } | null; sellers: SellerState[] }): Decision {
  const { known, sellers } = input
  const notes: string[] = []
  if (known) {
    const s = sellers.find(x => x.id === known.userId)
    if (s?.onShift) return { status: 'decided', rule: 'known_client', userId: s.id, name: s.name, reason: `клиент ${s.name}`, allOverloaded: false }
    notes.push(`клиент ${known.name} — ${s ? s.offReason ?? 'не на смене' : 'не продавец'}`)
  }

  const onShift = sellers.filter(s => s.onShift)
  if (onShift.length === 0) return { status: 'deferred', reason: [...notes, 'никого нет на смене — ждёт начала смены'].join('; ') }

  const skipped: string[] = []
  const free = onShift.filter(s => {
    const why = overload(s.load)
    if (why.length) skipped.push(`${s.name} — ${why.join(', ')}`)
    return why.length === 0
  })
  const off = sellers.filter(s => !s.onShift).map(s => `${s.name} — ${s.offReason ?? 'не на смене'}`)

  if (free.length === 0) {
    const s = [...onShift].sort((a, b) => loadSum(a.load) - loadSum(b.load) || a.todayCount - b.todayCount || a.id - b.id)[0]
    const reason = [...notes, `перегружены все на смене, отдано наименее загруженному`, ...skipped.map(x => `перегруз: ${x}`)].join('; ')
    return { status: 'decided', rule: 'least_loaded', userId: s.id, name: s.name, reason, allOverloaded: true }
  }

  const s = fairest(free)
  const reason = [
    ...notes,
    `по очереди: сегодня у ${s.name} ${s.todayCount} заяв.`,
    ...skipped.map(x => `пропущен(а): ${x}`),
    ...off.map(x => `не в очереди: ${x}`),
  ].join('; ')
  return { status: 'decided', rule: 'rotation', userId: s.id, name: s.name, reason, allOverloaded: false }
}

// Номер клиента из имени сделки АТС: «Пропущенный 79853140687 (79311097535 - 79311097535)»
export function phoneFromLeadName(name: string): string | null {
  const m = name.match(/^(?:пропущенный|входящий|исходящий)\s+(7\d{10})\b/i)
  return m ? m[1] : null
}

// Сделку «Исходящий 7…» АТС заводит на звонок менеджера клиенту без открытой сделки — это не заявка,
// звонящий и есть ответственный (с 30.09, галочка «новая сделка, если прошлая закрыта»)
export const OUTGOING_REASON = 'исходящий звонок менеджера — не заявка'

export function isOutgoingCallLead(name: string): boolean {
  return /^исходящий\s+7\d{10}\b/i.test(name.trim())
}

export function normalizePhone(raw: string): string | null {
  const d = raw.replace(/\D/g, '')
  if (d.length === 11 && (d.startsWith('7') || d.startsWith('8'))) return '7' + d.slice(1)
  if (d.length === 10) return '7' + d
  return null
}

// Чей это клиент: самая свежая другая сделка с ответственным-продавцом. Сделки моложе суток,
// которых нет в нашем журнале, не в счёт — у них ответственный по умолчанию АТС, а не выбор человека.
export function knownOwner(
  leadId: number,
  others: { id: number; created_at: number; responsible_user_id: number }[],
  logged: Map<number, number>,
  sellerIds: Set<number>,
  now: number,
): number | null {
  const candidates = others
    .filter(o => o.id !== leadId)
    .map(o => ({ at: o.created_at, owner: logged.get(o.id) ?? (now - o.created_at >= KNOWN_FRESH_SEC ? o.responsible_user_id : null) }))
    .filter((o): o is { at: number; owner: number } => o.owner !== null && sellerIds.has(o.owner))
    .sort((a, b) => b.at - a.at)
  return candidates[0]?.owner ?? null
}
