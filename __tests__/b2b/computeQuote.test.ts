import { describe, it, expect } from 'vitest'
import { computeQuoteItem } from '@/lib/b2b/computeQuote'
import type { SurchargeRule } from '@/lib/surcharges'
import type { B2BMaterial } from '@/lib/types'

// Гарантия идентичности: кабинет клиента и менеджер считают через один модуль.
// Ключевой регресс — авто-надбавка за габариты должна применяться в обоих
// (раньше партнёрский расчёт звал движок с пустыми услугами и НЕ добавлял её).

const MAT = {
  id: 1, name: 'Прозрачное М1', category: 'стекло', thickness: 6,
  cost_price: 1000, sale_price: 2200, vat_rate: 22, waste_percent: 30,
} as unknown as B2BMaterial

// высота 2700 → правило length 2600–2900 = +20%
const RULES: SurchargeRule[] = [
  { id: 2, axis: 'length', min_mm: 2600, max_mm: 2900, surcharge_percent: 20, label: 'Крупногабарит', shape_filter: null, active: true, sort_order: 11 },
]

describe('computeQuoteItem — единый расчёт клиент/менеджер', () => {
  it('применяет надбавку за габариты к крупной детали', () => {
    const dims = { material: MAT, width: 600, height: 2700, quantity: 1, applyMinPrice: false }
    const withRule = computeQuoteItem(dims, { facetPrices: [], surchargeRules: RULES })
    const noRule   = computeQuoteItem(dims, { facetPrices: [], surchargeRules: [] })

    expect(withRule.saleIncVat).toBeGreaterThan(noRule.saleIncVat)   // надбавка реально применилась
    expect(withRule.saleIncVat / noRule.saleIncVat).toBeCloseTo(1.2, 1) // ≈ +20%
    expect(withRule.services.some(s => /Крупногабарит/.test(s.name))).toBe(true)
  })

  it('для мелкой детали надбавок нет — цены совпадают', () => {
    const dims = { material: MAT, width: 500, height: 800, quantity: 1, applyMinPrice: false }
    const withRules = computeQuoteItem(dims, { facetPrices: [], surchargeRules: RULES })
    const noRules   = computeQuoteItem(dims, { facetPrices: [], surchargeRules: [] })
    expect(withRules.saleIncVat).toBe(noRules.saleIncVat)
  })
})
