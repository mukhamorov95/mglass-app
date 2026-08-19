import { describe, it, expect } from 'vitest'
import { computeRailing, STANDARD_STEP, type RailingSegment } from '@/lib/railingCalculator'
import { suggestHardware, priceRailing } from '@/lib/railingPricing'
import { DEFAULT_RAILING_RATES } from '@/lib/railingRates'

const rates = { ...DEFAULT_RAILING_RATES }
const SEGMENTS: RailingSegment[] = [{ name: 'Пролёт', spanMm: 3000, shape: 'raked' }]

function geo() {
  return computeRailing(SEGMENTS, {
    heightMm: 1100, thicknessMm: 10, materialName: 'Прозрачное',
    fixing: 'points', maxPanelWidthMm: 1200, step: STANDARD_STEP, costPerM2: 4500,
  })
}

describe('suggestHardware', () => {
  const g = geo()
  it('точки: 4 на пог.м по скату, себест 960/шт', () => {
    const h = suggestHardware('points', rates, g.alongSlopeTotalM)
    expect(h.unit).toBe('шт')
    expect(h.unitCost).toBe(960)
    expect(h.qty).toBe(Math.ceil(4 * g.alongSlopeTotalM))
  })
  it('стойки: 1 на пог.м + крайняя, себест 2950/шт', () => {
    const h = suggestHardware('posts', rates, g.alongSlopeTotalM)
    expect(h.unitCost).toBe(2950)
    expect(h.qty).toBe(Math.ceil(1 * g.alongSlopeTotalM) + 1)
  })
  it('профиль: погонаж по скату × (1 + запас 10%), себест 6000/пог.м', () => {
    const h = suggestHardware('profile', rates, g.alongSlopeTotalM)
    expect(h.unit).toBe('пог.м')
    expect(h.unitCost).toBe(6000)
    expect(h.qty).toBeCloseTo(g.alongSlopeTotalM * 1.1, 1)
  })
})

describe('priceRailing — монтаж наценивается по формуле', () => {
  const g = geo()
  const h = suggestHardware('points', rates, g.alongSlopeTotalM)
  const p = priceRailing({
    geometry: g, fixing: 'points',
    glassCostPerM2: 4500, hardwareQty: h.qty, hardwareUnitCost: h.unitCost,
    hardwareLabel: h.label, hardwareUnit: h.unit,
    withMount: true, mountPerM: 5500,
    withDelivery: false, deliveryCost: 0,
    marginPercent: 40, taxPercent: 12,
  })

  it('монтаж: себест 5500/пог.м → клиенту 5500/0.48 за пог.м', () => {
    const expectedMount = Math.round(g.alongSlopeTotalM * 5500 / 0.48)
    expect(p.mountPrice).toBe(expectedMount)
    // 5500/0.48 = 11458 ₽ за пог.м
    expect(Math.round(5500 / 0.48)).toBe(11458)
  })

  it('изделие наценено по формуле, grandTotal = изделие + монтаж', () => {
    const expectedProduct = Math.round(p.productCost / 0.48)
    expect(p.productPrice).toBe(expectedProduct)
    expect(p.grandTotal).toBe(p.productPrice + p.mountPrice)
    expect(p.serviceLines.find(s => s.name === 'Монтаж')?.total).toBe(p.mountPrice)
  })
})
