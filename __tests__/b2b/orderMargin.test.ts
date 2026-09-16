import { describe, it, expect } from 'vitest'
import { orderMarginPct, itemMarginPct, type B2BOrderItem } from '@/lib/b2bCalculator'

// Маржа заказа должна быть взвешенной по выручке: мелкая дорогая позиция не должна
// вытягивать общую цифру вверх (аудит итогов, A3 — «три разные маржи под одним словом»).
const item = (saleIncVat: number, costExVat: number, extra: Partial<B2BOrderItem> = {}) =>
  ({ saleIncVat, costExVat, ...extra } as unknown as B2BOrderItem)

describe('маржа заказа — одна цифра на систему', () => {
  it('взвешенная по выручке, а не среднее по позициям', () => {
    // мелкая с маржой 70% и крупная с маржой 10%
    const items = [item(12200, 3000), item(122000, 90000)]
    const avgByItems = Math.round((itemMarginPct(items[0], 0) + itemMarginPct(items[1], 0)) / 2)
    expect(avgByItems).toBe(40)              // среднее по позициям — так было на экране
    expect(orderMarginPct(items, 0)).toBe(15) // правда: почти вся выручка в дешёвой позиции
  })

  it('скидка снижает маржу заказа', () => {
    const items = [item(122000, 60000)]
    expect(orderMarginPct(items, 0)).toBe(40)
    expect(orderMarginPct(items, 20)).toBe(25)
  })

  it('договорная цена позиции считается конечной, скидка к ней не применяется', () => {
    const items = [item(122000, 60000, { manualTotal: 100000 })]
    expect(orderMarginPct(items, 20)).toBe(orderMarginPct(items, 0))
    expect(orderMarginPct(items, 0)).toBe(27)
  })

  it('пустой заказ — 0, без деления на ноль', () => {
    expect(orderMarginPct([], 10)).toBe(0)
    expect(orderMarginPct([item(0, 0)], 10)).toBe(0)
  })
})
