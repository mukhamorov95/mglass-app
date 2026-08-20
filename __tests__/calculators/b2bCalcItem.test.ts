import { describe, it, expect } from 'vitest'
import { calcItem, VAT } from '@/lib/b2bCalculator'
import type { B2BMaterial } from '@/lib/types'

// Ядро B2B-цены: calcItem. Его использует и форма калькулятора, и разбор чертежа.
// Фиксируем инварианты (обрезь, масштаб по кол-ву, НДС, закалка, мин-цена, маржа).
const MAT: B2BMaterial = {
  id: 1, name: 'Прозрачное М1', category: 'стекло', thickness: 8,
  cost_price: 781, sale_price: 2000, waste_percent: 30,
  sheet_width: 3210, sheet_height: 2250,
} as B2BMaterial

describe('calcItem — ядро B2B-цены', () => {
  it('обрезь: totalAreaBilled = totalAreaNet × (1 + waste%)', () => {
    const it20 = calcItem(MAT, 1000, 2000, 1, 20)
    expect(it20.totalAreaNet).toBeCloseTo(2, 4)                    // 1×2 м = 2 м²
    expect(it20.totalAreaBilled).toBeCloseTo(it20.totalAreaNet * 1.2, 3)
  })

  it('количество масштабирует площадь линейно', () => {
    const q1 = calcItem(MAT, 1000, 1000, 1, 0)
    const q3 = calcItem(MAT, 1000, 1000, 3, 0)
    expect(q3.totalAreaNet).toBeCloseTo(q1.totalAreaNet * 3, 4)
    expect(q3.totalWeight).toBeCloseTo(q1.totalWeight * 3, 1)
  })

  it('НДС: saleExVat = saleIncVat × 100/(100+НДС), outputVat = разница', () => {
    const r = calcItem(MAT, 1000, 2000, 1, 20)
    expect(r.saleExVat).toBe(Math.round(r.saleIncVat * 100 / (100 + VAT)))
    expect(r.outputVat).toBe(r.saleIncVat - r.saleExVat)
    expect(r.saleIncVat).toBeGreaterThan(r.saleExVat)
  })

  it('закалка добавляет себестоимость (costTempering и costExVat выше)', () => {
    const plain = calcItem(MAT, 1000, 2000, 1, 20, false)
    const temp  = calcItem(MAT, 1000, 2000, 1, 20, true)
    expect(plain.costTempering).toBe(0)
    expect(temp.costTempering).toBeGreaterThan(0)
    expect(temp.costExVat).toBeGreaterThan(plain.costExVat)
  })

  it('минимальная цена: мелкая деталь получает пол цены, без неё — дешевле', () => {
    const withFloor = calcItem(MAT, 100, 100, 1, 20, false, [], false, null, [], false, 2, null, [], true)
    const noFloor   = calcItem(MAT, 100, 100, 1, 20, false, [], false, null, [], false, 2, null, [], false)
    expect(withFloor.minPriceApplied).toBe(true)
    expect(withFloor.saleIncVat).toBeGreaterThan(noFloor.saleIncVat)
    expect(noFloor.minPriceApplied).toBeUndefined()
  })

  it('маржа положительна и в разумных пределах при цене выше себестоимости', () => {
    const r = calcItem(MAT, 1000, 2000, 1, 20)
    expect(r.margin).toBeGreaterThan(0)
    expect(r.margin).toBeLessThan(100)
  })
})
