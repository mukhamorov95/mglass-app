import { describe, it, expect } from 'vitest'
import { marginOf, parsePct, priceForMargin, saleNetCost, tenth } from '@/lib/glassPrice/marginPrice'

describe('цена по марже в справочнике стекла', () => {
  it('туда и обратно: под ценой показывается введённый процент, цена — наименьшая такая', () => {
    for (const net of [612.4, 1180, 2333.7, 5120.05])
      for (const opex of [0, 12, 18.5])
        for (const m of [10, 25, 35, 40.1, 45, 47.4]) {
          const p = priceForMargin(net, opex, m)!
          const tag = `${net}/${opex}/${m} → ${p}`
          const shown = tenth(marginOf(p, net, opex))
          expect(shown, tag).toBeGreaterThanOrEqual(tenth(m))
          // рубль цены сдвигает процент меньше чем на 0,1, когда цена от ~1500 ₽ — тогда ровно введённый
          if (p >= 1500) expect(shown, tag).toBe(tenth(m))
          else expect(shown, tag).toBeLessThanOrEqual(tenth(m + 0.1))
          expect(tenth(marginOf(p - 1, net, opex)), tag).toBeLessThan(tenth(m))
        }
  })
  it('процент под ценой — как раньше на экране: опекс округляется до рубля', () => {
    expect(marginOf(3300, 1500, 15)).toBeCloseTo((3300 - 1500 - 495) / 3300 * 100, 10)
  })
  it('себестоимость без НДС: расход, НДС закупки, закалка у стекла', () => {
    expect(saleNetCost({ cost: 1200, wastePct: 0, purchaseVatPct: 20 })).toBeCloseTo(1000, 10)
    expect(saleNetCost({ cost: 1200, wastePct: 10, purchaseVatPct: 20 })).toBeCloseTo(1100, 10)
    expect(saleNetCost({ cost: 1200, wastePct: 10, purchaseVatPct: 20, temperingPerM2: 600, temperingVatPct: 20 })).toBeCloseTo(1650, 10)
  })
  it('недостижимая маржа и пустая себестоимость — без цены', () => {
    expect(priceForMargin(1000, 20, 80)).toBeNull()
    expect(priceForMargin(0, 10, 30)).toBeNull()
  })
  it('ввод процента: запятая, знак %, пробелы', () => {
    expect(parsePct('45,5 %')).toBe(45.5)
    expect(parsePct('45')).toBe(45)
    expect(parsePct('сорок')).toBeNull()
    expect(parsePct('')).toBeNull()
  })
})
