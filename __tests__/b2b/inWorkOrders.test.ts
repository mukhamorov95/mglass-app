import { describe, it, expect } from 'vitest'
import { daysInWork, oldestFirst, daysInWorkLabel } from '@/lib/b2b/inWorkOrders'

describe('заказы в работе: возраст и порядок', () => {
  it('считает календарные дни, день запуска — ноль', () => {
    expect(daysInWork('2026-11-03', '2026-11-03')).toBe(0)
    expect(daysInWork('2026-11-02', '2026-11-03')).toBe(1)
    expect(daysInWork('2026-07-01', '2026-11-03')).toBe(125)
    expect(daysInWork('2025-12-31', '2026-01-01')).toBe(1)
  })

  it('заказ с датой из будущего не даёт отрицательных дней', () => {
    expect(daysInWork('2026-11-05', '2026-11-03')).toBe(0)
  })

  it('сверху самые старые, при равной дате — меньший номер', () => {
    const list = [
      { id: 30, d: '2026-10-01' },
      { id: 12, d: '2026-07-01' },
      { id: 20, d: '2026-10-01' },
      { id: 5, d: '2026-11-03' },
    ]
    expect(oldestFirst(list, x => x.d).map(x => x.id)).toEqual([12, 20, 30, 5])
    expect(list[0].id).toBe(30)   // исходный список не меняется
  })

  it('дата со временем сравнивается по дню', () => {
    const list = [{ id: 2, d: '2026-10-01T23:00:00Z' }, { id: 1, d: '2026-10-01' }]
    expect(oldestFirst(list, x => x.d).map(x => x.id)).toEqual([1, 2])
  })

  it('подпись склоняет дни', () => {
    expect(daysInWorkLabel(0)).toBe('запущен сегодня')
    expect(daysInWorkLabel(1)).toBe('1 день в работе')
    expect(daysInWorkLabel(3)).toBe('3 дня в работе')
    expect(daysInWorkLabel(11)).toBe('11 дней в работе')
    expect(daysInWorkLabel(21)).toBe('21 день в работе')
    expect(daysInWorkLabel(112)).toBe('112 дней в работе')
    expect(daysInWorkLabel(125)).toBe('125 дней в работе')
  })
})
