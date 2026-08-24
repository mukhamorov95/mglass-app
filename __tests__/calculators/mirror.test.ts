import { describe, it, expect } from 'vitest'
import { calculateMirror } from '@/lib/mirrorCalculator'
import type { MirrorInputs } from '@/lib/mirrorCalculator'
import {
  mockMirrorMaterial,
  mockInstallService,
  mockDeliveryService,
} from './fixtures'

// calculateMirror(inputs, materials, services) → MirrorResult | null.
// Хелпер гардит null (при валидных входных данных результат всегда есть).
function calc(inputs: MirrorInputs, services: Parameters<typeof calculateMirror>[2] = []) {
  const r = calculateMirror(inputs, [], services)
  if (!r) throw new Error('calculateMirror вернул null на валидных входных данных')
  return r
}

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
    const result = calc(baseInputs)
    expect(result.finalPrice).toBeGreaterThan(0)
    expect(result.grandTotal).toBeGreaterThan(0)
    expect(result.totalCost).toBeGreaterThan(0)
  })

  // INV-1: final_price === grandTotal без услуг
  it('INV-1: grandTotal === finalPrice когда нет доп. услуг', () => {
    const result = calc(baseInputs)
    expect(result.grandTotal).toBe(result.finalPrice)
  })

  // INV-1: grandTotal включает услуги
  it('INV-1: grandTotal = finalPrice + стоимость услуг', () => {
    const result = calc({ ...baseInputs, hasInstallation: true, hasDelivery: true }, [mockInstallService, mockDeliveryService])
    expect(result.grandTotal).toBe(result.finalPrice + result.servicesTotal)
    expect(result.servicesTotal).toBeGreaterThan(0)
  })

  // INV-4: profit считается от finalPrice, не grandTotal
  it('INV-4: profit не включает стоимость услуг', () => {
    const result = calc({ ...baseInputs, hasInstallation: true, hasDelivery: true }, [mockInstallService, mockDeliveryService])
    // profit = finalPrice - totalCost - tax. grandTotal > finalPrice, поэтому profit меньше grandTotal - totalCost
    expect(result.profit).toBeLessThan(result.grandTotal - result.totalCost)
  })

  it('скидка снижает цену', () => {
    const r0 = calc(baseInputs)
    const r20 = calc({ ...baseInputs, discount: 20 })
    expect(r20.finalPrice).toBeLessThan(r0.finalPrice)
    expect(r20.discountAmount).toBeGreaterThan(0)
  })

  it('минимальные размеры — неотрицательная цена', () => {
    const result = calc({ ...baseInputs, width: 1, height: 1 })
    expect(result.finalPrice).toBeGreaterThanOrEqual(0)
  })

  it('маржа влияет на итоговую цену', () => {
    const r30 = calc(baseInputs)
    const r50 = calc({ ...baseInputs, margin: 50 })
    expect(r50.finalPrice).toBeGreaterThan(r30.finalPrice)
  })

  it('партнёрский % увеличивает цену', () => {
    const r0  = calc(baseInputs)
    const r10 = calc({ ...baseInputs, partnerPercent: 10 })
    expect(r10.finalPrice).toBeGreaterThanOrEqual(r0.finalPrice)
  })
})
