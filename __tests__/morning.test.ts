import { describe, it, expect } from 'vitest'
import { addBookFacts, calls, dayLabel, emptyMonth, isWorkday, pickDay, plural, prevMonth, signals, type DayRow, type Schedule } from '@/lib/morning'

const row = (patch: Partial<DayRow>): DayRow => ({
  day: '2026-10-01', amo_user_id: 1, name: 'Александра', first_at: null, last_at: null, active_hours: null, longest_pause_min: null,
  actions: 0, messages_own: 0, messages_no_author: 0, client_messages: 0, reply_median_min: null, replies_counted: 0,
  unanswered: 0, left_waiting: 0, tasks_completed: 0, tasks_postponed: 0, cards_moved: 0,
  calls_out: 0, calls_out_ok: 0, calls_in: 0, calls_in_missed: 0, talk_sec: 0,
  leads_received: null, first_contact_median_min: null, adv_measure: null, adv_kp: null, adv_invoice: null, adv_paid: null,
  pbx_out: null, pbx_out_ok: null, pbx_in: null, pbx_talk_sec: null, app_quick: 0, app_calcs: 0, app_kp: 0, app_contracts: 0,
  ...patch,
})
const sch: Schedule = { amo_user_id: 1, name: 'Александра', work_from: '09:00:00', work_to: '18:00:00', work_days: [1, 2, 3, 4, 5], starts_on: null }

describe('pickDay — какой день показывать как «вчера»', () => {
  it('в понедельник — пятница, а не пустое воскресенье', () => {
    const days = [
      { day: '2026-10-02', actions: 60 }, { day: '2026-10-03', actions: 0 }, { day: '2026-10-04', actions: 0 },
    ]
    expect(pickDay(days, '2026-10-05')).toBe('2026-10-02')
  })
  it('суббота дежурного с минутой работы — не «последний рабочий день»: берём пятницу по графику', () => {
    const days = [{ day: '2026-10-02', actions: 64 }, { day: '2026-10-03', actions: 43 }, { day: '2026-10-04', actions: 0 }]
    const weekday = (d: string) => isWorkday(d, sch)
    expect(pickDay(days, '2026-10-05', weekday)).toBe('2026-10-02')
    expect(pickDay(days, '2026-10-05')).toBe('2026-10-03')
  })
  it('сегодняшний день не берётся, даже если в нём уже есть действия', () => {
    expect(pickDay([{ day: '2026-10-05', actions: 10 }, { day: '2026-10-04', actions: 3 }], '2026-10-05')).toBe('2026-10-04')
  })
  it('никто не работал — последний прошедший день; снимков нет — null', () => {
    expect(pickDay([{ day: '2026-10-03', actions: 0 }, { day: '2026-10-04', actions: 0 }], '2026-10-05')).toBe('2026-10-04')
    expect(pickDay([], '2026-10-05')).toBeNull()
  })
})

describe('dayLabel', () => {
  it('вчера — «Вчера», иначе — «Последний рабочий день»', () => {
    expect(dayLabel('2026-10-04', '2026-10-05')).toEqual({ title: 'Вчера', date: 'воскресенье, 4 октября' })
    expect(dayLabel('2026-10-02', '2026-10-05').title).toBe('Последний рабочий день')
  })
})

describe('месяц из книги', () => {
  it('«Поступило» = предоплаты + остатки; итог книги money_total не прибавляется второй раз', () => {
    const m = addBookFacts(emptyMonth(), [
      { metric: 'prepay', value: 556276 }, { metric: 'remainder', value: '145894' }, { metric: 'money_total', value: 702170 },
      { metric: 'payments', value: 8 }, { metric: 'talks', value: 375 },
    ])
    expect(m.prepay + m.remainder).toBe(702170)
    expect([m.payments, m.talks]).toEqual([8, 375])
  })
  it('прошлый месяц через границу года', () => {
    expect(prevMonth('2026-01')).toBe('2025-12')
    expect(prevMonth('2026-10')).toBe('2026-09')
  })
})

describe('calls — звонки из АТС, если она ответила', () => {
  it('АТС есть — её цифры, пропущенные из amo', () => {
    const c = calls(row({ calls_out: 3, calls_out_ok: 3, calls_in_missed: 1, pbx_out: 5, pbx_out_ok: 4, pbx_in: 0, pbx_talk_sec: 162 }))
    expect(c).toEqual({ source: 'АТС', out: 5, ok: 4, in: 0, missed: 1, talkSec: 162 })
  })
  it('АТС не ответила — цифры amo, а не нули', () => {
    expect(calls(row({ calls_out: 3, calls_out_ok: 2, talk_sec: 90 })).out).toBe(3)
    expect(calls(row({ calls_out: 3, calls_out_ok: 2, talk_sec: 90 })).source).toBe('amo')
  })
})

describe('signals — что заметить владельцу', () => {
  it('рабочий день по графику без действий', () => {
    expect(signals(undefined, sch, '2026-10-01')).toEqual(['рабочий день по графику, а своих действий в amo нет'])
  })
  it('выходной без действий — не сигнал', () => {
    expect(signals(undefined, sch, '2026-10-04')).toEqual([])
    expect(isWorkday('2026-10-04', sch)).toBe(false)
  })
  it('до даты выхода на работу — не в вину', () => {
    expect(isWorkday('2026-09-08', { ...sch, starts_on: '2026-09-09' })).toBe(false)
  })
  it('первое действие на два часа и позже графика, клиенты без ответа, пропущенные', () => {
    const s = signals(row({ actions: 143, first_at: '2026-10-01T11:16:00Z', left_waiting: 2, calls_in_missed: 1 }), sch, '2026-10-01')
    expect(s).toEqual([
      'первое действие в amo в 14:16 при графике с 09:00',
      'к вечеру без ответа осталось клиентов: 2',
      'пропущенных входящих: 1',
    ])
  })
  it('начал в 10:30 при графике с 9:00 — меньше двух часов, не сигнал', () => {
    expect(signals(row({ actions: 50, first_at: '2026-10-01T07:30:00Z' }), sch, '2026-10-01')).toEqual([])
  })
})

describe('plural', () => {
  it('1 объект, 3 объекта, 5 и 11 объектов, 21 объект', () => {
    const o = (n: number) => `${n} ${plural(n, 'объект', 'объекта', 'объектов')}`
    expect([o(1), o(3), o(5), o(11), o(21), o(0)]).toEqual(['1 объект', '3 объекта', '5 объектов', '11 объектов', '21 объект', '0 объектов'])
  })
})
