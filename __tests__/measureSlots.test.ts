import { describe, it, expect } from 'vitest'
import { planDay, checkBooking, startChoices, mskToIso, mskDate, mskMinutes, isoWeekday, fromMin, type Booking, type DayOff } from '@/lib/measure/slots'

const M = 'm-1'
const book = (id: number, date: string, time: string, extra: Partial<Booking> = {}): Booking =>
  ({ id, measurer_id: M, scheduled_at: mskToIso(date, time), duration_min: 90, status: 'scheduled', ...extra })

describe('московское время', () => {
  it('туда и обратно без сдвига пояса', () => {
    const iso = mskToIso('2026-10-02', '12:00')
    expect(iso).toBe('2026-10-02T09:00:00.000Z')
    expect(mskDate(iso)).toBe('2026-10-02')
    expect(mskMinutes(iso)).toBe(720)
  })
  it('поздний вечер по Москве — всё ещё тот же день', () => {
    expect(mskDate(mskToIso('2026-10-02', '23:30'))).toBe('2026-10-02')
  })
  it('день недели ISO', () => {
    expect(isoWeekday('2026-09-30')).toBe(3) // среда
    expect(isoWeekday('2026-10-04')).toBe(7) // воскресенье
  })
})

describe('planDay', () => {
  it('пустой рабочий день — одно окно от начала до «конец минус длительность»', () => {
    const d = planDay({ date: '2026-10-02', measurerId: M, daysOff: [], bookings: [] })
    // пн–пт 9–18: последний замер на 1,5 ч начинается в 16:30
    expect(d.starts.map(s => [fromMin(s.from), fromMin(s.to)])).toEqual([['09:00', '16:30']])
  })

  it('замер 12:00–13:30 вырезает окно с запасом на дорогу с обеих сторон', () => {
    const d = planDay({ date: '2026-10-02', measurerId: M, daysOff: [], bookings: [book(1, '2026-10-02', '12:00')] })
    // начать можно до 12:00 − 60 − 90 = 09:30 и с 13:30 + 60 = 14:30
    expect(d.starts.map(s => [fromMin(s.from), fromMin(s.to)])).toEqual([['09:00', '09:30'], ['14:30', '16:30']])
    expect(d.busy).toHaveLength(1)
  })

  it('чужой замерщик и отменённый замер не занимают день', () => {
    const d = planDay({
      date: '2026-10-02', measurerId: M, daysOff: [],
      bookings: [book(1, '2026-10-02', '12:00', { measurer_id: 'm-2' }), book(2, '2026-10-02', '15:00', { status: 'cancelled' })],
    })
    expect(d.busy).toHaveLength(0)
    expect(d.starts).toHaveLength(1)
  })

  it('отпуск и нерабочий день — окон нет, причина названа', () => {
    const off: DayOff[] = [{ measurer_id: M, date_from: '2026-10-15', date_to: '2026-10-25', note: 'отпуск' }]
    const a = planDay({ date: '2026-10-20', measurerId: M, daysOff: off, bookings: [] })
    expect(a.off?.note).toBe('отпуск')
    expect(a.starts).toEqual([])
    const b = planDay({ date: '2026-10-04', measurerId: M, daysOff: [], bookings: [] }) // воскресенье
    expect(b.working).toBe(false)
    expect(b.starts).toEqual([])
  })

  it('сегодня: прошедшее время не предлагаем', () => {
    const d = planDay({ date: '2026-10-02', measurerId: M, daysOff: [], bookings: [], notBeforeMin: 16 * 60 })
    expect(d.starts.map(s => [fromMin(s.from), fromMin(s.to)])).toEqual([['16:00', '16:30']])
  })

  it('у стоящего замера своя дорога до него — окно перед ним короче', () => {
    // до замера в 15:00 замерщик заложил 2 часа дороги: начать раньше можно не позже 15:00 − 120 − 90 = 11:30
    const d = planDay({ date: '2026-10-02', measurerId: M, daysOff: [], bookings: [book(1, '2026-10-02', '15:00', { travel_min: 120 })] })
    expect(d.starts.map(s => [fromMin(s.from), fromMin(s.to)])).toEqual([['09:00', '11:30']])
  })

  it('дорога до нового замера от предыдущего — своя оценка', () => {
    const one = [book(1, '2026-10-02', '09:00')]
    const d60 = planDay({ date: '2026-10-02', measurerId: M, daysOff: [], bookings: one })
    const d120 = planDay({ date: '2026-10-02', measurerId: M, daysOff: [], bookings: one, travelMin: 120 })
    expect(fromMin(d60.starts[0].from)).toBe('11:30')
    expect(fromMin(d120.starts[0].from)).toBe('12:30')
  })

  it('суббота по умолчанию нерабочая', () => {
    expect(planDay({ date: '2026-10-03', measurerId: M, daysOff: [], bookings: [] }).working).toBe(false)
  })

  it('день забит — окон нет', () => {
    const d = planDay({
      date: '2026-10-02', measurerId: M, daysOff: [],
      bookings: [book(1, '2026-10-02', '09:30'), book(2, '2026-10-02', '13:00'), book(3, '2026-10-02', '16:30')],
    })
    expect(d.starts).toEqual([])
  })
})

describe('startChoices', () => {
  it('сетка по 30 минут внутри окон', () => {
    expect(startChoices([{ from: 540, to: 600 }, { from: 870, to: 900 }]).map(fromMin)).toEqual(['09:00', '09:30', '10:00', '14:30', '15:00'])
  })
})

describe('checkBooking', () => {
  const bookings = [book(1, '2026-10-02', '12:00', { address: 'Красногорск' })]

  it('пересечение — жёсткий отказ с адресом того замера', () => {
    const c = checkBooking({ startIso: mskToIso('2026-10-02', '13:00'), measurerId: M, daysOff: [], bookings })
    expect(c).toEqual([{ kind: 'overlap', hard: true, message: 'пересекается с замером 12:00–13:30 (Красногорск)' }])
  })

  it('впритык без дороги — предупреждение, не отказ', () => {
    const c = checkBooking({ startIso: mskToIso('2026-10-02', '14:00'), measurerId: M, daysOff: [], bookings })
    expect(c).toEqual([{ kind: 'travel', hard: false, message: 'после замера 12:00–13:30 (Красногорск) всего 30 мин, а на дорогу заложено 60' }])
  })

  it('дорога от предыдущего — по оценке замерщика', () => {
    const at = mskToIso('2026-10-02', '15:00') // после 12:00–13:30 — 90 мин
    expect(checkBooking({ startIso: at, measurerId: M, daysOff: [], bookings, travelMin: 60 })).toEqual([])
    expect(checkBooking({ startIso: at, measurerId: M, daysOff: [], bookings, travelMin: 120 })[0]).toMatchObject({ kind: 'travel', hard: false })
  })

  it('дорога до следующего — по его собственной оценке', () => {
    const next = (travel_min: number | null) => [book(5, '2026-10-02', '14:00', { travel_min })]
    const at = mskToIso('2026-10-02', '12:00') // закончится в 13:30, до следующего 30 мин
    expect(checkBooking({ startIso: at, measurerId: M, daysOff: [], bookings: next(30) })).toEqual([])
    expect(checkBooking({ startIso: at, measurerId: M, daysOff: [], bookings: next(null) })[0])
      .toMatchObject({ kind: 'travel', message: 'до замера 14:00–15:30 останется 30 мин, а на дорогу туда заложено 60' })
  })

  it('перенос самого себя не конфликтует с собой', () => {
    const c = checkBooking({ startIso: mskToIso('2026-10-02', '12:30'), measurerId: M, daysOff: [], bookings, excludeId: 1 })
    expect(c).toEqual([])
  })

  it('отпуск — жёстко; вне часов и воскресенье — мягко', () => {
    const off: DayOff[] = [{ measurer_id: M, date_from: '2026-10-15', date_to: '2026-10-25', note: 'отпуск' }]
    expect(checkBooking({ startIso: mskToIso('2026-10-16', '10:00'), measurerId: M, daysOff: off, bookings: [] })[0])
      .toMatchObject({ kind: 'day_off', hard: true })
    expect(checkBooking({ startIso: mskToIso('2026-10-02', '17:00'), measurerId: M, daysOff: [], bookings: [] }))
      .toEqual([{ kind: 'outside_hours', hard: false, message: 'вне рабочих часов 09:00–18:00' }])
    expect(checkBooking({ startIso: mskToIso('2026-10-04', '10:00'), measurerId: M, daysOff: [], bookings: [] })[0])
      .toMatchObject({ kind: 'not_working_day', hard: false })
  })

  it('свободное окно из planDay проходит checkBooking без замечаний', () => {
    const d = planDay({ date: '2026-10-02', measurerId: M, daysOff: [], bookings })
    for (const t of startChoices(d.starts)) {
      expect(checkBooking({ startIso: mskToIso('2026-10-02', fromMin(t)), measurerId: M, daysOff: [], bookings })).toEqual([])
    }
  })
})
