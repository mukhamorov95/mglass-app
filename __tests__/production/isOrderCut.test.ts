import { describe, it, expect } from 'vitest'
import { isOrderCut } from '@/lib/orderFlags'

describe('нарезан = материал уже был', () => {
  it('отметка резки, упаковки или отгрузки — нарезан', () => {
    expect(isOrderCut({ cut: '2026-10-01' }, false)).toBe(true)
    expect(isOrderCut({ packaged: true }, false)).toBe(true)
    expect(isOrderCut({ shipped: '2026-10-02' }, false)).toBe(true)
  })
  it('закрытая задача резки цеха — нарезан и без отметки этапа', () => {
    expect(isOrderCut({}, true)).toBe(true)
    expect(isOrderCut(undefined, true)).toBe(true)
  })
  it('ни отметки, ни резки — не нарезан; пустые отметки не считаются', () => {
    expect(isOrderCut({}, false)).toBe(false)
    expect(isOrderCut({ cut: null, packaged: '', shipped: false }, false)).toBe(false)
    expect(isOrderCut(null, false)).toBe(false)
  })
})
