import { describe, it, expect } from 'vitest'
import { orderMarginPct, itemMarginPct, calcTotals, type B2BOrderItem } from '@/lib/b2bCalculator'

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

// Прибыль и НДС на экране заказа: обе величины считаются от суммы после скидки
// и в одной базе — без НДС. Владелец 22.09: «прибыль завышена ровно на НДС».
describe('прибыль заказа не включает НДС к уплате', () => {
  const items = [{
    saleIncVat: 3000, saleExVat: 2459, outputVat: 541,
    costWithVat: 1430, costExVat: 1172, inputVat: 258,
    totalAreaNet: 1, totalWeight: 10, quantity: 1,
  }]

  it('прибыль = продажа без НДС − себестоимость без НДС', () => {
    const t = calcTotals(items as never, 0)
    expect(t.totalSaleExVatAfterDiscount).toBe(2459)
    expect(t.profit).toBe(2459 - 1172)
  })

  it('на экране прибыль и НДС к уплате больше не задваиваются', () => {
    const t = calcTotals(items as never, 0)
    // итог с НДС = прибыль + себестоимость без НДС + НДС к уплате + входной НДС
    expect(t.profit + t.totalCostExVat + t.vatToState + t.totalInputVat).toBe(t.totalAfterDiscount)
  })

  it('скидка уменьшает и прибыль, и НДС к уплате', () => {
    const full = calcTotals(items as never, 0)
    const disc = calcTotals(items as never, 20)
    expect(disc.profit).toBeLessThan(full.profit)
    expect(disc.vatToState).toBeLessThan(full.vatToState)
  })
})
