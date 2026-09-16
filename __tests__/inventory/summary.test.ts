import { describe, it, expect } from 'vitest'
import { stockSummary, stockStatus, type SummaryItem } from '@/lib/inventory/units'

const it_ = (p: Partial<SummaryItem>): SummaryItem =>
  ({ qty: 0, min_qty: 0, target_qty: 0, avg_cost: 0, contour: 'b2b', ...p })

describe('сводка склада — плашки сходятся со списком', () => {
  const items = [
    it_({ qty: 10, avg_cost: 100, contour: 'b2b' }),                 // 1 000 ₽
    it_({ qty: 5,  avg_cost: 200, contour: 'b2c', min_qty: 5 }),     // 1 000 ₽, «мало»
    it_({ qty: 0,  avg_cost: 300, contour: 'both', min_qty: 2 }),    // 0 ₽, «нет»
    it_({ qty: 4,  avg_cost: 50,  contour: 'both' }),                // 200 ₽
  ]

  it('B2B + B2C + оба = общая стоимость, без двойного счёта', () => {
    const s = stockSummary(items)
    expect(s.totalValue).toBe(2200)
    expect(s.b2b.value + s.b2c.value + s.both.value).toBe(s.totalValue)
    expect(s.b2b.items + s.b2c.items + s.both.items).toBe(s.items)
  })

  it('дефицит и «кончилось» — по тому же правилу, что статус строки', () => {
    const s = stockSummary(items)
    expect(s.deficit).toBe(1)   // «мало»
    expect(s.zero).toBe(1)      // «нет»
    // позиция с нулём раньше попадала и в дефицит, и в «кончилось»
    expect(stockStatus(items[2])).toBe('out')
  })

  it('пустой список — нули, без деления на ноль', () => {
    const s = stockSummary([])
    expect(s).toMatchObject({ items: 0, totalValue: 0, deficit: 0, zero: 0 })
  })

  it('отрицательный остаток не уменьшает стоимость запаса', () => {
    expect(stockSummary([it_({ qty: -3, avg_cost: 100 })]).totalValue).toBe(0)
  })
})
