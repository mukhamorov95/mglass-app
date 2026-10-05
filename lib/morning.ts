// «Утро» менеджера и «Команда» владельца (docs/MANAGER_MORNING_ROUTE.md, М2–М3).
// Чистые правила: какой день показывать как «вчера», как сложить месяц и что
// подсветить владельцу. Данные — lib/morningData.ts.

import type { ManagerDayRow } from '@/lib/managerDay'

export type DayRow = ManagerDayRow & { updated_at?: string }

export type MonthMoney = {
  salesCount: number
  salesSum: number
  prepay: number
  remainder: number
  payments: number
  talks: number
  measureAssigned: number
  measureDone: number
}

export const emptyMonth = (): MonthMoney => ({
  salesCount: 0, salesSum: 0, prepay: 0, remainder: 0, payments: 0, talks: 0, measureAssigned: 0, measureDone: 0,
})

const METRIC_FIELD: Record<string, keyof MonthMoney> = {
  prepay: 'prepay', remainder: 'remainder', payments: 'payments',
  talks: 'talks', measure_assigned: 'measureAssigned', measure_done: 'measureDone',
}

// Показатели книги по имени из книги. money_total не берём: «Поступило» = предоплаты
// + остатки, иначе на экране сумма частей не сойдётся с итогом.
export function addBookFacts(into: MonthMoney, facts: { metric: string; value: number | string }[]): MonthMoney {
  for (const f of facts) {
    const k = METRIC_FIELD[f.metric]
    if (k) into[k] += Number(f.value) || 0
  }
  return into
}

// «Вчера» — последний прошедший рабочий по графику день, когда в amo кто-то работал.
// В понедельник это пятница: ни пустое воскресенье, ни суббота дежурного, где
// пара минут работы одного человека и нули у остальных.
export function pickDay(rows: { day: string; actions: number }[], today: string, workday?: (day: string) => boolean): string | null {
  const past = rows.filter(r => r.day < today)
  const last = (xs: { day: string }[]) => (xs.length ? xs.map(r => r.day).sort().at(-1)! : null)
  const worked = past.filter(r => r.actions > 0)
  return (workday ? last(worked.filter(r => workday(r.day))) : null) ?? last(worked) ?? last(past)
}

export const plural = (n: number, one: string, few: string, many: string) => {
  const a = Math.abs(n) % 100, b = a % 10
  return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many
}

const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота']
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']

// chosen — день выбран руками: тогда это не «последний рабочий», а просто дата.
export function dayLabel(day: string, today: string, chosen = false): { title: string; date: string } {
  const d = new Date(`${day}T12:00:00Z`)
  const date = `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS_GEN[d.getUTCMonth()]}`
  const yesterday = addDays(today, -1)
  if (day === today) return { title: 'Сегодня', date }
  if (day === yesterday) return { title: 'Вчера', date }
  if (!chosen) return { title: 'Последний рабочий день', date }
  const year = day.slice(0, 4) === today.slice(0, 4) ? '' : ` ${day.slice(0, 4)}`
  return { title: `${d.getUTCDate()} ${MONTHS_GEN[d.getUTCMonth()]}${year}`, date: WEEKDAYS[d.getUTCDay()] }
}

export const monthName = (month: string) => MONTHS_NOM[Number(month.slice(5, 7)) - 1]

// «16–30 сентября» — отрезок дней внутри одного месяца.
export const dayRange = (from: string, to: string) =>
  `${Number(from.slice(8, 10))}–${Number(to.slice(8, 10))} ${MONTHS_GEN[Number(from.slice(5, 7)) - 1]}`

export const ratePct = (r: number) => `${r.toLocaleString('ru-RU')} %`

export function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0, 12)).toISOString().slice(0, 10)
}

export const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

export function prevMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7)
}

export function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7)
}

export const hm = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }) : null

export function duration(sec: number): string {
  const m = Math.round(sec / 60)
  return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${m % 60} мин`
}

export const rub = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`

// Звонки: АТС, если она в этот день ответила, — она видит и то, чего нет в amo.
// Пропущенные — из amo: АТС не знает, чей был пропущенный.
export function calls(r: DayRow) {
  const pbx = r.pbx_out != null
  return {
    source: pbx ? 'АТС' : 'amo',
    out: pbx ? r.pbx_out! : r.calls_out,
    ok: pbx ? r.pbx_out_ok! : r.calls_out_ok,
    in: pbx ? r.pbx_in! : r.calls_in,
    missed: r.calls_in_missed,
    talkSec: pbx ? r.pbx_talk_sec! : r.talk_sec,
  }
}

export type Schedule = { amo_user_id: number; name: string; work_from: string | null; work_to: string | null; work_days: number[]; starts_on: string | null }

export function isWorkday(day: string, s: Schedule | undefined): boolean {
  if (!s || !s.work_days?.length) return false
  if (s.starts_on && day < s.starts_on) return false
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay() || 7
  return s.work_days.includes(dow)
}

// Что владельцу заметить за день. Только то, что видно из данных, без оценок людей.
// at — время снимка незаконченного дня (сегодня): «нет действий» не сигнал, пока от
// начала графика не прошло двух часов, а «без ответа» — на момент снимка, не к вечеру.
export function signals(r: DayRow | undefined, s: Schedule | undefined, day: string, at?: string): string[] {
  const out: string[] = []
  const workday = isWorkday(day, s)
  const from = s?.work_from?.slice(0, 5)
  if (!r || r.actions === 0) {
    if (!workday) return out
    if (!at) out.push('рабочий день по графику, а своих действий в amo нет')
    else if (from && toMin(at) - toMin(from) >= 120) out.push(`к ${at} своих действий в amo нет при графике с ${from}`)
    return out
  }
  if (workday && from && r.first_at) {
    const start = hm(r.first_at)!
    if (toMin(start) - toMin(from) >= 120) out.push(`первое действие в amo в ${start} при графике с ${from}`)
  }
  if (r.left_waiting > 0) out.push(at ? `на ${at} без ответа клиентов: ${r.left_waiting}` : `к вечеру без ответа осталось клиентов: ${r.left_waiting}`)
  if (r.calls_in_missed > 0) out.push(`пропущенных входящих: ${r.calls_in_missed}`)
  return out
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

// ── Период на «Команде»: день, месяц, год, свои даты ──────────────────────────

export type View =
  | { kind: 'auto' }
  | { kind: 'day'; day: string }
  | { kind: 'range'; from: string; to: string; month: string | null }

export const FIRST_DAY = '2024-01-01'   // раньше нет ни продаж, ни книги
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const validDay = (d: string) => DAY_RE.test(d) && addDays(d, 0) === d

// Отрезок, ровно совпадающий с календарным месяцем (текущий — по сегодня), — это месяц:
// для него есть план и сравнение с прошлым месяцем.
export function rangeMonth(from: string, to: string, today: string): string | null {
  const m = from.slice(0, 7)
  if (from !== `${m}-01`) return null
  const end = monthEnd(m)
  return to === end || (to === today && end > today) ? m : null
}

const range = (from: string, to: string, today: string): View => {
  const t = to > today ? today : to
  return { kind: 'range', from, to: t, month: rangeMonth(from, t, today) }
}

// Адрес → что показывать. Ошибку возвращаем текстом: страница покажет её и «вчера».
export function parseView(sp: { d?: string; from?: string; to?: string; month?: string; year?: string }, today: string): { view: View; error?: string } {
  const auto: View = { kind: 'auto' }
  if (sp.d) {
    if (!validDay(sp.d) || sp.d < FIRST_DAY) return { view: auto, error: `нет такого дня: ${sp.d}` }
    if (sp.d > today) return { view: auto, error: 'день ещё не наступил' }
    return { view: { kind: 'day', day: sp.d } }
  }
  if (sp.month) {
    if (!MONTH_RE.test(sp.month) || `${sp.month}-01` < FIRST_DAY || sp.month > today.slice(0, 7)) return { view: auto, error: `нет такого месяца: ${sp.month}` }
    return { view: range(`${sp.month}-01`, monthEnd(sp.month), today) }
  }
  if (sp.year) {
    if (!/^\d{4}$/.test(sp.year) || sp.year < FIRST_DAY.slice(0, 4) || sp.year > today.slice(0, 4)) return { view: auto, error: `нет такого года: ${sp.year}` }
    return { view: range(`${sp.year}-01-01`, `${sp.year}-12-31`, today) }
  }
  if (sp.from || sp.to) {
    const from = sp.from ?? '', to = sp.to ?? ''
    if (!validDay(from) || !validDay(to)) return { view: auto, error: 'период: нужны обе даты' }
    if (from > to) return { view: auto, error: 'период: начало позже конца' }
    if (from > today) return { view: auto, error: 'период ещё не наступил' }
    return { view: range(from < FIRST_DAY ? FIRST_DAY : from, to, today) }
  }
  return { view: auto }
}

const short = (d: string, withYear: boolean) =>
  `${Number(d.slice(8, 10))} ${MONTHS_GEN[Number(d.slice(5, 7)) - 1]}${withYear ? ` ${d.slice(0, 4)}` : ''}`

// «Октябрь», «2026 год», «1 сентября – 4 октября». Год пишем, только если он не текущий.
export function periodTitle(from: string, to: string, today: string): string {
  const y = today.slice(0, 4)
  const m = rangeMonth(from, to, today)
  if (m) return `${monthName(m)}${m.slice(0, 4) === y ? '' : ` ${m.slice(0, 4)}`}`
  if (from.slice(5) === '01-01' && (to.slice(5) === '12-31' || to === today) && from.slice(0, 4) === to.slice(0, 4)) return `${from.slice(0, 4)} год`
  if (from === to) return short(from, from.slice(0, 4) !== y)
  const years = from.slice(0, 4) !== y || to.slice(0, 4) !== y
  return `${short(from, years && from.slice(0, 4) !== to.slice(0, 4))} – ${short(to, years)}`
}

// Книга: закрытый месяц, целиком попавший в период, берём итогом месяца (как «Мои
// деньги» и «Показатели менеджеров»), остальное — по дням. В июне 2026 итог месяца
// и сумма дней у одного человека расходятся на 70 794 ₽ — нельзя мешать источники.
export function bookSplit(from: string, to: string, currentMonth: string): { months: string[]; daily: (date: string) => boolean } {
  const months: string[] = []
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = nextMonth(m)) {
    if (m < currentMonth && `${m}-01` >= from && monthEnd(m) <= to) months.push(m)
  }
  return { months, daily: (date: string) => date >= from && date <= to && !months.includes(date.slice(0, 7)) }
}

export type Activity = {
  days: number          // дней со снимком в периоде
  workdays: number      // из них рабочих по графику
  worked: number        // дней со своими действиями в amo
  idle: number          // рабочих по графику без действий
  late: number          // рабочих, где первое действие на 2 часа и позже графика
  startAvg: string | null  // среднее первое действие в рабочие дни, ЧЧ:ММ
  out: number; ok: number; in: number; missed: number; talkSec: number
  msgs: number; moved: number; kp: number; inv: number
}

// Активность человека за период — сумма снимков дня. days — дни, за которые снимок
// команды есть: день без снимка не считается днём без работы.
export function sumActivity(rows: DayRow[], s: Schedule | undefined, days: string[]): Activity {
  const a: Activity = { days: days.length, workdays: 0, worked: 0, idle: 0, late: 0, startAvg: null, out: 0, ok: 0, in: 0, missed: 0, talkSec: 0, msgs: 0, moved: 0, kp: 0, inv: 0 }
  const byDay = new Map(rows.map(r => [r.day, r]))
  const from = s?.work_from?.slice(0, 5)
  const starts: number[] = []
  for (const day of days) {
    const r = byDay.get(day)
    const work = isWorkday(day, s)
    if (work) a.workdays++
    if (r) {
      const c = calls(r)
      a.out += c.out; a.ok += c.ok; a.in += c.in; a.missed += c.missed; a.talkSec += c.talkSec
      a.msgs += r.messages_own + r.messages_no_author
      a.moved += r.cards_moved; a.kp += r.adv_kp ?? 0; a.inv += r.adv_invoice ?? 0
    }
    if (r && r.actions > 0) {
      a.worked++
      if (work && r.first_at) {
        const start = toMin(hm(r.first_at)!)
        starts.push(start)
        if (from && start - toMin(from) >= 120) a.late++
      }
    } else if (work) a.idle++
  }
  if (starts.length) {
    const avg = Math.round(starts.reduce((x, y) => x + y, 0) / starts.length)
    a.startAvg = `${String(Math.floor(avg / 60)).padStart(2, '0')}:${String(avg % 60).padStart(2, '0')}`
  }
  return a
}
