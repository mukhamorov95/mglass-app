// Сравнение рабочего дня из AmoCRM с графиком менеджера (таблица manager_schedules).
// Нет графика — нет и нарушений: без нормы «короткий день» может быть согласованным.

import { mskMinuteOfDay, type DayActivity } from '@/lib/amoActivity'

export type ManagerSchedule = {
  amo_user_id: number
  name: string
  starts_on: string | null   // ГГГГ-ММ-ДД — с этого дня человек должен работать
  work_from: string | null   // ЧЧ:ММ[:СС]
  work_to: string | null
  work_days: number[]        // 1 = пн … 7 = вс
  note: string | null
}

export type DayCheck = {
  expected: boolean      // рабочий по графику день
  notStarted: boolean    // до starts_on — человеку ещё не в вину
  absent: boolean        // рабочий день без единого действия
  lateMin: number | null
  earlyMin: number | null
}

export type PeriodCheck = {
  expectedDays: number
  absentDays: string[]
  lateDays: number
  earlyDays: number
}

// Первое действие в amo — не приход на работу: прочитать чаты и подумать можно без следа.
// Поэтому это «начал в amo позже нормы», а не «опоздал», и допуск 15 минут.
export const GRACE_MIN = 15

const toMin = (t: string | null) => {
  if (!t) return null
  const [h, m] = t.split(':').map(Number)
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null
}

const isoWeekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay() || 7

// now — чтобы сегодняшний день не считать «ранним уходом», пока смена не кончилась.
export function checkDay(d: DayActivity, s: ManagerSchedule | undefined, now: number): DayCheck {
  const none: DayCheck = { expected: false, notStarted: false, absent: false, lateMin: null, earlyMin: null }
  if (!s) return none
  if (s.starts_on && d.day < s.starts_on) return { ...none, notStarted: true }
  if (!s.work_days.includes(isoWeekday(d.day))) return none

  const from = toMin(s.work_from)
  const to = toMin(s.work_to)
  const nowMin = mskMinuteOfDay(now)
  const isToday = d.day === new Date((now + 3 * 3600) * 1000).toISOString().slice(0, 10)
  const out: DayCheck = { ...none, expected: true }
  if (d.firstAt === null) {
    out.absent = !isToday || (from !== null && nowMin > from + GRACE_MIN)
    return out
  }
  const first = mskMinuteOfDay(d.firstAt)
  const last = mskMinuteOfDay(d.lastAt!)
  if (from !== null && first > from + GRACE_MIN) out.lateMin = first - from
  if (to !== null && last < to - GRACE_MIN && !(isToday && nowMin < to)) out.earlyMin = to - last
  return out
}

export function checkPeriod(days: DayActivity[], s: ManagerSchedule | undefined, now: number): PeriodCheck {
  const res: PeriodCheck = { expectedDays: 0, absentDays: [], lateDays: 0, earlyDays: 0 }
  for (const d of days) {
    const c = checkDay(d, s, now)
    if (!c.expected) continue
    res.expectedDays++
    if (c.absent) res.absentDays.push(d.day)
    if (c.lateMin !== null) res.lateDays++
    if (c.earlyMin !== null) res.earlyDays++
  }
  return res
}

export const fmtHm = (t: string | null) => (t ? t.slice(0, 5) : '')

// Суббота по графику — выходной у всех, работает дежурный (со слов владельца 22.09.2026).
// Дежурный — тот из менеджеров с графиком, кто в субботу что-то делал в amo.
export type SaturdayDuty = { day: string; onDuty: { userId: number; name: string; firstAt: number; lastAt: number; actions: number }[] }

// Субботы берём из дней периода, а не из людей: в субботу без дежурного людей в отчёте нет вовсе.
export function saturdayDuty(
  periodDays: string[],
  managers: { userId: number; name: string; days: DayActivity[] }[],
  scheduled: Set<number>,
): SaturdayDuty[] {
  return periodDays.filter(d => isoWeekday(d) === 6).map(day => ({
    day,
    onDuty: managers
      .filter(m => scheduled.has(m.userId))
      .map(m => ({ m, d: m.days.find(x => x.day === day) }))
      .filter(x => x.d && x.d.firstAt !== null)
      .map(({ m, d }) => ({ userId: m.userId, name: m.name, firstAt: d!.firstAt!, lastAt: d!.lastAt!, actions: d!.actions }))
      .sort((a, b) => b.actions - a.actions),
  }))
}
