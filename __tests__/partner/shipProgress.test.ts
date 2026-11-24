import { describe, it, expect } from 'vitest'
import { shipPartial, earlierLines } from '@/lib/partner/shipProgress'

describe('shipPartial', () => {
  const items = [{ localId: 'a', quantity: 3 }, { quantity: 2 }]
  it('частично — штуки из отгрузок по ключам строк', () => {
    expect(shipPartial(items, k => (k === 'a' ? 3 : 0))).toEqual({ shipped: 3, total: 5 })
    expect(shipPartial(items, k => (k === 'i1' ? 1 : 0))).toEqual({ shipped: 1, total: 5 })
  })
  it('ничего или всё — не частично', () => {
    expect(shipPartial(items, () => 0)).toBeNull()
    expect(shipPartial(items, k => (k === 'a' ? 3 : 2))).toBeNull()
  })
  it('лишнее по строке не перекрывает другую', () => {
    expect(shipPartial(items, k => (k === 'a' ? 9 : 0))).toEqual({ shipped: 3, total: 5 })
  })
  it('уехало раньше из заметки', () => {
    expect(earlierLines({ shipped_earlier: { lines: { a: 2, b: 0, c: 'x' } } })).toEqual({ a: 2 })
    expect(earlierLines({})).toEqual({})
  })
})
