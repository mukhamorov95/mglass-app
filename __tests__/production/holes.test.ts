import { describe, it, expect } from 'vitest'
import { normalizeHoles, totalHoles, holesLabel, holesIncomplete, isValidHole } from '@/lib/production/holes'

describe('отверстия: группы «сколько × диаметр»', () => {
  it('несколько групп на одной детали', () => {
    const g = normalizeHoles([{ d: 12, n: 4 }, { d: 20, n: 2 }])
    expect(g).toHaveLength(2)
    expect(totalHoles(g)).toBe(6)
    expect(holesLabel(g)).toBe('4×⌀12 · 2×⌀20')
  })

  it('мусор и нули отбрасываются, а не считаются', () => {
    expect(normalizeHoles([{ d: 0, n: 4 }, { d: 12, n: 0 }, { d: -5, n: 2 }])).toEqual([])
    expect(normalizeHoles('нет')).toEqual([])
    expect(normalizeHoles(null)).toEqual([])
  })

  it('строки из формы приводятся к числам', () => {
    expect(normalizeHoles([{ d: '12', n: '4' }])).toEqual([{ d: 12, n: 4 }])
  })

  it('дробные округляются: сверло целое, отверстий целое число', () => {
    expect(normalizeHoles([{ d: 11.6, n: 3.4 }])).toEqual([{ d: 12, n: 3 }])
  })

  it('отверстия заявлены, но не расписаны — это видно', () => {
    expect(holesIncomplete(true, [])).toBe(true)
    expect(holesIncomplete(true, [{ d: 12, n: 4 }])).toBe(false)
    expect(holesIncomplete(false, [])).toBe(false)
  })

  it('валидность группы', () => {
    expect(isValidHole({ d: 12, n: 1 })).toBe(true)
    expect(isValidHole({ d: 12, n: 0 })).toBe(false)
    expect(isValidHole({ d: NaN, n: 2 })).toBe(false)
  })
})
