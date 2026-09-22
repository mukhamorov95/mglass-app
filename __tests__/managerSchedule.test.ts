import { describe, it, expect } from 'vitest'
import { checkDay, checkPeriod, type ManagerSchedule } from '@/lib/managerSchedule'
import { mskDayStart, type DayActivity } from '@/lib/amoActivity'

const day = (d: string, first: string | null, last: string | null): DayActivity => {
  const ts = (hm: string | null) => (hm ? mskDayStart(d) + Number(hm.slice(0, 2)) * 3600 + Number(hm.slice(3)) * 60 : null)
  return {
    day: d, firstAt: ts(first), lastAt: ts(last), activeHours: 0, longestPauseMin: 0, actions: first ? 10 : 0,
    hourly: [], hourlyNoAuthor: [], messagesOwn: 0, messagesNoAuthor: 0, clientMessages: 0, tasksCompleted: 0,
    tasksPostponed: 0, cardsMoved: 0, callsOut: 0, callsOutConnected: 0, callsInAnswered: 0, callsInMissed: 0,
    talkSeconds: 0, replyMinutes: [], unanswered: 0,
  }
}
const alina: ManagerSchedule = {
  amo_user_id: 8272804, name: 'Алина', starts_on: '2026-09-09',
  work_from: '09:00:00', work_to: '18:00:00', work_days: [1, 2, 3, 4, 5], note: null,
}
const later = mskDayStart('2026-09-30')

describe('график', () => {
  it('до даты выхода день не в вину', () => {
    const c = checkDay(day('2026-09-02', null, null), alina, later)
    expect(c.notStarted).toBe(true)
    expect(c.absent).toBe(false)
  })

  it('рабочий день без действий — пропуск, выходной — нет', () => {
    expect(checkDay(day('2026-09-10', null, null), alina, later).absent).toBe(true)
    expect(checkDay(day('2026-09-13', null, null), alina, later).expected).toBe(false)
  })

  it('опоздание и ранний уход — с допуском 15 минут', () => {
    expect(checkDay(day('2026-09-10', '09:10', '17:50'), alina, later)).toMatchObject({ lateMin: null, earlyMin: null })
    expect(checkDay(day('2026-09-10', '09:40', '16:15'), alina, later)).toMatchObject({ lateMin: 40, earlyMin: 105 })
  })

  it('сегодня до конца смены ранним уходом не считается', () => {
    const noon = mskDayStart('2026-09-22') + 12 * 3600
    expect(checkDay(day('2026-09-22', '09:05', '11:50'), alina, noon).earlyMin).toBeNull()
    expect(checkDay(day('2026-09-22', null, null), alina, mskDayStart('2026-09-22') + 8 * 3600).absent).toBe(false)
  })

  it('без графика нарушений нет', () => {
    expect(checkDay(day('2026-09-10', '12:00', '13:00'), undefined, later).expected).toBe(false)
  })

  it('за период: рабочие дни, пропуски, опоздания, ранние уходы', () => {
    const p = checkPeriod([
      day('2026-09-04', null, null),
      day('2026-09-09', '10:36', '16:50'),
      day('2026-09-10', '09:22', '13:51'),
      day('2026-09-11', null, null),
      day('2026-09-12', null, null),
    ], alina, later)
    expect(p).toEqual({ expectedDays: 3, absentDays: ['2026-09-11'], lateDays: 2, earlyDays: 2 })
  })
})
