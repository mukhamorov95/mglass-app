import { describe, it, expect } from 'vitest'
import { addBookFacts, bookSplit, calls, dayLabel, emptyMonth, isWorkday, parseView, periodTitle, pickDay, plural, prevMonth, signals, sumActivity, type DayRow, type Schedule } from '@/lib/morning'

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
  it('выбранный руками день — дата, сегодняшний — «Сегодня»', () => {
    expect(dayLabel('2026-10-05', '2026-10-05', true).title).toBe('Сегодня')
    expect(dayLabel('2026-09-15', '2026-10-05', true)).toEqual({ title: '15 сентября', date: 'вторник' })
    expect(dayLabel('2025-12-31', '2026-10-05', true).title).toBe('31 декабря 2025')
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
  it('сегодня, снимок в 10:40: «нет действий» ещё не сигнал; в 11:05 — уже', () => {
    expect(signals(undefined, sch, '2026-10-05', '10:40')).toEqual([])
    expect(signals(undefined, sch, '2026-10-05', '11:05')).toEqual(['к 11:05 своих действий в amo нет при графике с 09:00'])
    expect(signals(row({ actions: 5, first_at: '2026-10-05T06:10:00Z', left_waiting: 3 }), sch, '2026-10-05', '11:05'))
      .toEqual(['на 11:05 без ответа клиентов: 3'])
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

describe('parseView — что выбрано на «Команде»', () => {
  const T = '2026-10-05'
  it('без параметров — последний рабочий день', () => {
    expect(parseView({}, T)).toEqual({ view: { kind: 'auto' } })
  })
  it('день: сегодня можно, завтра и кривую дату — нет', () => {
    expect(parseView({ d: T }, T).view).toEqual({ kind: 'day', day: T })
    expect(parseView({ d: '2026-10-06' }, T).error).toBe('день ещё не наступил')
    expect(parseView({ d: '2026-02-30' }, T).error).toMatch('нет такого дня')
  })
  it('текущий месяц — по сегодня и остаётся месяцем; прошлый — целиком', () => {
    expect(parseView({ month: '2026-10' }, T).view).toEqual({ kind: 'range', from: '2026-10-01', to: T, month: '2026-10' })
    expect(parseView({ month: '2026-09' }, T).view).toEqual({ kind: 'range', from: '2026-09-01', to: '2026-09-30', month: '2026-09' })
    expect(parseView({ month: '2026-11' }, T).error).toMatch('нет такого месяца')
  })
  it('год — с 1 января по сегодня; свои даты — конец не дальше сегодня', () => {
    expect(parseView({ year: '2026' }, T).view).toEqual({ kind: 'range', from: '2026-01-01', to: T, month: null })
    expect(parseView({ from: '2026-09-01', to: '2026-12-01' }, T).view).toEqual({ kind: 'range', from: '2026-09-01', to: T, month: null })
    expect(parseView({ from: '2026-09-10', to: '2026-09-01' }, T).error).toBe('период: начало позже конца')
    expect(parseView({ from: '2026-09-01', to: '2026-09-30' }, T).view).toMatchObject({ month: '2026-09' })
  })
})

describe('periodTitle', () => {
  const T = '2026-10-05'
  it('месяц, год, отрезок, другой год', () => {
    expect(periodTitle('2026-10-01', T, T)).toBe('Октябрь')
    expect(periodTitle('2025-06-01', '2025-06-30', T)).toBe('Июнь 2025')
    expect(periodTitle('2026-01-01', T, T)).toBe('2026 год')
    expect(periodTitle('2025-01-01', '2025-12-31', T)).toBe('2025 год')
    expect(periodTitle('2026-09-29', T, T)).toBe('29 сентября – 5 октября')
    expect(periodTitle('2025-12-20', '2026-01-10', T)).toBe('20 декабря 2025 – 10 января 2026')
  })
})

describe('bookSplit — итог месяца или дни', () => {
  it('год по 5 октября: январь–сентябрь итогами, октябрь по дням', () => {
    const b = bookSplit('2026-01-01', '2026-10-05', '2026-10')
    expect(b.months).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'])
    expect([b.daily('2026-10-03'), b.daily('2026-06-15'), b.daily('2026-10-06')]).toEqual([true, false, false])
  })
  it('края периода — по дням, целый месяц внутри — итогом', () => {
    const b = bookSplit('2026-06-15', '2026-08-10', '2026-10')
    expect(b.months).toEqual(['2026-07'])
    expect([b.daily('2026-06-14'), b.daily('2026-06-15'), b.daily('2026-07-20'), b.daily('2026-08-10')]).toEqual([false, true, false, true])
  })
})

describe('sumActivity — неделя одного человека', () => {
  // пн 28.09 — пт 02.10 и выходные; снимков нет за 30.09
  const days = ['2026-09-28', '2026-09-29', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']
  const rows = [
    row({ day: '2026-09-28', actions: 50, first_at: '2026-09-28T06:00:00Z', calls_out: 4, calls_out_ok: 2, messages_own: 10, cards_moved: 3, adv_kp: 1, adv_invoice: 0 }),
    row({ day: '2026-09-29', actions: 40, first_at: '2026-09-29T09:30:00Z', pbx_out: 7, pbx_out_ok: 5, pbx_in: 1, pbx_talk_sec: 600, messages_no_author: 2 }),
    row({ day: '2026-10-03', actions: 5, first_at: '2026-10-03T08:00:00Z' }),
  ]
  const a = sumActivity(rows, sch, days)
  it('рабочие дни по графику и без действий; выходной с работой — в «днях в amo»', () => {
    expect([a.days, a.workdays, a.worked, a.idle, a.late]).toEqual([6, 4, 3, 2, 1])
  })
  it('звонки — АТС, где ответила; среднее начало — по рабочим дням', () => {
    expect([a.out, a.ok, a.in, a.talkSec, a.msgs, a.moved, a.kp]).toEqual([11, 7, 1, 600, 12, 3, 1])
    expect(a.startAvg).toBe('10:45')   // 09:00 и 12:30 по Москве
  })
})
