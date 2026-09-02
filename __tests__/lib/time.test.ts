import { describe, it, expect } from 'vitest'
import { mskTime, mskDayKey, mskDayShort, mskDateTime } from '@/lib/time'

// Опорная точка: отметка Никиты 28.08.2026, 07:43:44 UTC. В Москве это 10:43 —
// именно это расхождение владелец и заметил на экране «Кто что делал».
const MARK = '2026-08-28T07:43:44.144Z'

describe('время приложения — московское', () => {
  it('UTC-отметка показывается по Москве, а не по UTC', () => {
    expect(mskTime(MARK)).toBe('10:43')
  })

  it('день считается по Москве: 22:30 UTC — это уже завтра', () => {
    expect(mskDayKey('2026-08-28T22:30:00Z')).toBe('2026-08-29')
  })

  it('день по Москве не уезжает назад в обычной середине дня', () => {
    expect(mskDayKey(MARK)).toBe('2026-08-28')
  })

  it('полночь по Москве принадлежит наступившему дню', () => {
    expect(mskDayKey('2026-08-27T21:00:00Z')).toBe('2026-08-28')
  })

  it('короткая дата и дата со временем — тоже по Москве', () => {
    expect(mskDayShort(MARK)).toBe('28.08')
    expect(mskDateTime(MARK)).toContain('10:43')
  })

  it('результат не зависит от часового пояса машины, где идёт сборка', () => {
    // Vercel собирает и рендерит в UTC — раньше именно это и ломало экраны.
    const tz = process.env.TZ
    process.env.TZ = 'UTC'
    expect(mskTime(MARK)).toBe('10:43')
    process.env.TZ = tz
  })
})
