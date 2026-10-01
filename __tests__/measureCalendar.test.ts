import { describe, it, expect } from 'vitest'
import { monthGrid } from '@/components/measure/MeasurerCalendar'
import { addDays, isoWeekday } from '@/lib/measure/slots'

describe('сетка месяца календаря замерщика', () => {
  it('октябрь 2026: с понедельника 28.09 по воскресенье 01.11 — 5 недель', () => {
    expect(monthGrid('2026-10')).toEqual({ start: '2026-09-28', days: 35 })
  })
  it('февраль 2027 начинается в понедельник — без хвоста января', () => {
    expect(monthGrid('2027-02')).toEqual({ start: '2027-02-01', days: 28 })
  })
  it('любой месяц: начало — понедельник, конец — воскресенье, весь месяц внутри, не больше 6 недель', () => {
    for (let m = 1; m <= 12; m++) {
      const month = `2026-${String(m).padStart(2, '0')}`
      const g = monthGrid(month)
      const end = addDays(g.start, g.days - 1)
      expect(isoWeekday(g.start)).toBe(1)
      expect(isoWeekday(end)).toBe(7)
      expect(g.start <= `${month}-01`).toBe(true)
      expect(end >= addDays(`${month}-28`, 0)).toBe(true)
      expect(g.days % 7).toBe(0)
      expect(g.days).toBeLessThanOrEqual(42)
    }
  })
})
