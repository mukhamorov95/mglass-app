import { describe, it, expect } from 'vitest'
import { cellDelta, fmtPct, fmtRub, summarize, type PriceChange } from '@/lib/glassPrice/priceDelta'

const change = (old_value: number | null, new_value: number): PriceChange =>
  ({ matrix_name: 'Серебро', matrix_category: 'mirror', thickness: 4, old_value, new_value })

describe('cellDelta', () => {
  it('было → стало по журналу применения', () => {
    const d = cellDelta(change(730, 820), 820)!
    expect(d).toMatchObject({ old: 730, now: 820, rub: 90 })
    expect(fmtPct(d.pct)).toBe('+12,3 %')
    expect(d.old + d.rub).toBe(d.now)   // показанное сходится: 730 + 90 = 820
  })

  it('цену после прайса поправили руками — разницу не показываем', () => {
    expect(cellDelta(change(730, 820), 850)).toBeNull()
  })

  it('ячейка не менялась прайсом или раньше была пустой — разницы нет', () => {
    expect(cellDelta(undefined, 820)).toBeNull()
    expect(cellDelta(change(null, 993), 993)).toBeNull()
  })

  it('подешевело — со знаком минус', () => {
    const d = cellDelta(change(740, 690), 690)!
    expect(fmtRub(d.rub)).toBe('−50')
    expect(fmtPct(d.pct)).toBe('−6,8 %')
  })
})

describe('fmtRub', () => {
  it('разряды и знак', () => {
    expect(fmtRub(1026 - 959)).toBe('+67')
    expect(fmtRub(-4180)).toMatch(/^−4\s180$/)
  })
})

describe('summarize', () => {
  it('сколько выросло, сколько снизилось и разброс', () => {
    const s = summarize([cellDelta(change(730, 820), 820)!, cellDelta(change(740, 690), 690)!])!
    expect(s).toMatchObject({ total: 2, up: 1, down: 1 })
    expect(fmtPct(s.minPct)).toBe('−6,8 %')
    expect(fmtPct(s.maxPct)).toBe('+12,3 %')
  })

  it('пусто — нет сводки', () => {
    expect(summarize([])).toBeNull()
  })
})
