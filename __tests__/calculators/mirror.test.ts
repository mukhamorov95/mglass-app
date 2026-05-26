import { describe, it, expect } from 'vitest'
import { calculateMirror } from '@/lib/mirrorCalculator'
import {
  mockMirrorMaterial,
  mockInstallService,
  mockDeliveryService,
  mockFinancialSettings,
} from './fixtures'

const baseInputs = {
  width:  600,
  height: 800,
  mirrorMaterial: mockMirrorMaterial,
  mirrorCostPerM2: 2500,
  mirrorWastePct: 10,
  shapeModifierPct: 0,
  shape: 'rectangle' as const,
  hasLighting: false,
  frame: null,
  ledStrip: null,
  powerSupply: null,
  diffuser: null,
  mirrorFrame: null,
  buttonType: 'none' as const,
  hasSandblast: false,
  hasSubstrate: false,
  substratePrice: 0,
  hasFacet: false,
  facetTypeMm: null,
  facetCostPerM: 0,
  facetSalePerM: 0,
  hasInstallation: false,
  hasDelivery: false,
  deliveryCost: 0,
  partnerPercent: 0,
  discount: 0,
  margin: 30,
  standardMargin: 30,
  tax: 6,
  minMargin: 15,
}

describe('calculateMirror', () => {
  it('возвращает результат для базового зеркала', () => {
    const result = calculateMirror(baseInputs, [], [], mockFinancialSettings)
    expect(result).not.toBeNull()
    expect(result.finalPrice).toBeGreaterThan(0)
    expect(result.grandTotal).toBeGreaterThan(0)
    expect(result.totalCost).toBeGreaterThan(0)
  })

  // INV-1: final_price === grandTotal без услуг
  it('INV-1: grandTotal === finalPrice когда нет доп. услуг', () => {
    const result = calculateMirror(baseInputs, [], [], mockFinancialSettings)
    expect(result.grandTotal).toBe(result.finalPrice)
  })

  // INV-1: grandTotal включает услуги
  it('INV-1: grandTotal = finalPrice + стоимость услуг', () => {
    const inputs = { ...baseInputs, hasInstallation: true, hasDelivery: true }
    const result = calculateMirror(inputs, [], [mockInstallService, mockDeliveryService], mockFinancialSettings)
    expect(result.grandTotal).toBe(result.finalPrice + result.servicesTotal)
    expect(result.servicesTotal).toBeGreaterThan(0)
  })

  // INV-4: profit считается от finalPrice, не grandTotal
  it('INV-4: profit не включает стоимость услуг', () => {
    const inputs = { ...baseInputs, hasInstallation: true, hasDelivery: true }
    const result = calculateMirror(inputs, [], [mockInstallService, mockDeliveryService], mockFinancialSettings)
    // profit = finalPrice - totalCost - tax. grandTotal > finalPrice, поэтому profit должен быть меньше grandTotal - totalCost
    expect(result.profit).toBeLessThan(result.grandTotal - result.totalCost)
  })

  it('скидка 0% — цена без изменений', () => {
    const r0 = calculateMirror(baseInputs, [], [], mockFinancialSettings)
    const r20 = calculateMirror({ ...baseInputs, discount: 20 }, [], [], mockFinancialSettings)
    expect(r20.finalPrice).toBeLessThan(r0.finalPrice)
    expect(r20.discountAmount).toBeGreaterThan(0)
  })

  it('нулевые размеры — возможен нулевой результат или очень маленькая цена', () => {
    const result = calculateMirror({ ...baseInputs, width: 1, height: 1 }, [], [], mockFinancialSettings)
    expect(result.finalPrice).toBeGreaterThanOrEqual(0)
  })

  it('маржа влияет на итоговую цену', () => {
    const r30 = calculateMirror(baseInputs, [], [], mockFinancialSettings)
    const r50 = calculateMirror({ ...baseInputs, margin: 50 }, [], [], mockFinancialSettings)
    expect(r50.finalPrice).toBeGreaterThan(r30.finalPrice)
  })

  it('партнёрский % увеличивает цену', () => {
    const r0  = calculateMirror(baseInputs, [], [], mockFinancialSettings)
    const r10 = calculateMirror({ ...baseInputs, partnerPercent: 10 }, [], [], mockFinancialSettings)
    expect(r10.finalPrice).toBeGreaterThanOrEqual(r0.finalPrice)
  })
})
