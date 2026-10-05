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

// «Вчера» — последний прошедший день, когда в amo вообще кто-то работал. В понедельник
// это пятница (или суббота дежурного), а не пустое воскресенье.
export function pickDay(rows: { day: string; actions: number }[], today: string): string | null {
  const past = rows.filter(r => r.day < today)
  const worked = past.filter(r => r.actions > 0).map(r => r.day).sort()
  if (worked.length) return worked[worked.length - 1]
  const any = past.map(r => r.day).sort()
  return any.length ? any[any.length - 1] : null
}

const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота']
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']

export function dayLabel(day: string, today: string): { title: string; date: string } {
  const d = new Date(`${day}T12:00:00Z`)
  const date = `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS_GEN[d.getUTCMonth()]}`
  const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
  return { title: day === yesterday ? 'Вчера' : 'Последний рабочий день', date }
}

export const monthName = (month: string) => MONTHS_NOM[Number(month.slice(5, 7)) - 1]

export function prevMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7)
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
export function signals(r: DayRow | undefined, s: Schedule | undefined, day: string): string[] {
  const out: string[] = []
  const workday = isWorkday(day, s)
  if (!r || r.actions === 0) {
    if (workday) out.push('рабочий день по графику, а своих действий в amo нет')
    return out
  }
  if (workday && s?.work_from && r.first_at) {
    const start = hm(r.first_at)!
    const late = toMin(start) - toMin(s.work_from.slice(0, 5))
    if (late >= 120) out.push(`первое действие в amo в ${start} при графике с ${s.work_from.slice(0, 5)}`)
  }
  if (r.left_waiting > 0) out.push(`к вечеру без ответа осталось клиентов: ${r.left_waiting}`)
  if (r.calls_in_missed > 0) out.push(`пропущенных входящих: ${r.calls_in_missed}`)
  return out
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
