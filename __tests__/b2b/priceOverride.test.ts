import { describe, it, expect } from 'vitest'
import { distributeTargetTotal, clearAutoOverride, hasAutoOverride, orderMarginPercent } from '@/lib/b2b/priceOverride'
import { effectiveItemTotal, type B2BOrderItem } from '@/lib/b2bCalculator'

// Ручная корректировка итога просчёта: сумма, которую вписал менеджер, должна стать
// итогом ДО РУБЛЯ и разложиться по позициям пропорционально прайсу.

const item = (saleIncVat: number, extra: Partial<B2BOrderItem> = {}) =>
  ({ saleIncVat, saleExVat: Math.round(saleIncVat * 100 / 122), costExVat: Math.round(saleIncVat * 0.5), ...extra }) as unknown as B2BOrderItem

const sum = (items: B2BOrderItem[]) => items.reduce((s, i) => s + effectiveItemTotal(i, 0), 0)

describe('distributeTargetTotal', () => {
  it('раскладывает целевую сумму до рубля', () => {
    const items = [item(38008), item(22496), item(146721), item(1)]
    const res = distributeTargetTotal(items, 150000)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.appliedTotal).toBe(150000)
    expect(sum(res.items)).toBe(150000)
    expect(res.items.every(i => i.manualAuto === true)).toBe(true)
  })

  it('пропорционально прайсу и фиксирует скидку', () => {
    const res = distributeTargetTotal([item(100000), item(50000)], 120000)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.items[0].manualTotal).toBe(80000)
    expect(res.items[1].manualTotal).toBe(40000)
    expect(res.discountPercent).toBe(20)
    expect(res.markupPercent).toBe(0)
  })

  it('наценка вверх — скидка 0, markup положительный', () => {
    const res = distributeTargetTotal([item(100000)], 110000)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.discountPercent).toBe(0)
    expect(res.markupPercent).toBe(10)
    expect(res.appliedTotal).toBe(110000)
  })

  it('повторная корректировка не наслаивается — считает от прайса', () => {
    const once = distributeTargetTotal([item(100000), item(50000)], 120000)
    expect(once.ok).toBe(true)
    if (!once.ok) return
    const twice = distributeTargetTotal(once.items, 150000)
    expect(twice.ok).toBe(true)
    if (!twice.ok) return
    expect(twice.appliedTotal).toBe(150000)
    expect(twice.items[0].manualTotal).toBe(100000)
    expect(twice.discountPercent).toBe(0)
  })

  it('договорные позиции (ручная цена без manualAuto) не пересчитываются', () => {
    const items = [item(100000), item(50000, { manualTotal: 30000 })]
    const res = distributeTargetTotal(items, 100000)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.items[1].manualTotal).toBe(30000)
    expect(res.items[1].manualAuto).toBeUndefined()
    expect(res.items[0].manualTotal).toBe(70000)
    expect(sum(res.items)).toBe(100000)
  })

  it('нельзя уйти ниже суммы договорных позиций', () => {
    const items = [item(100000), item(50000, { manualTotal: 30000 })]
    const res = distributeTargetTotal(items, 25000)
    expect(res.ok).toBe(false)
  })

  it('пустой список и мусорная сумма отбиваются', () => {
    expect(distributeTargetTotal([], 1000).ok).toBe(false)
    expect(distributeTargetTotal([item(1000)], 0).ok).toBe(false)
    expect(distributeTargetTotal([item(1000)], Number.NaN).ok).toBe(false)
  })

  it('копеечные остатки не теряются на длинном списке', () => {
    const items = Array.from({ length: 17 }, (_, i) => item(1000 + i * 137))
    const res = distributeTargetTotal(items, 19999)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(sum(res.items)).toBe(19999)
  })
})

describe('clearAutoOverride', () => {
  it('снимает только авто-цены, договорные оставляет', () => {
    const items = [item(100000, { manualTotal: 80000, manualAuto: true }), item(50000, { manualTotal: 30000 })]
    expect(hasAutoOverride(items)).toBe(true)
    const cleared = clearAutoOverride(items)
    expect(cleared[0].manualTotal).toBeNull()
    expect(cleared[1].manualTotal).toBe(30000)
    expect(hasAutoOverride(cleared)).toBe(false)
  })
})

describe('orderMarginPercent', () => {
  it('падает вслед за скидкой', () => {
    const items = [item(100000)]
    const full = orderMarginPercent(items, 0)
    const res = distributeTargetTotal(items, 70000)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(orderMarginPercent(res.items, res.discountPercent)).toBeLessThan(full)
  })
})
