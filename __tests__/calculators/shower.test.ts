import { describe, it, expect } from 'vitest'
import { calculateShower, SHOWER_MODELS, TIER_CONFIGS } from '@/lib/showerCalculator'
import { mockShowerInstallService, mockShowerDeliveryService } from './fixtures'

const tier   = TIER_CONFIGS[1]   // standard
const model  = SHOWER_MODELS[1]  // M2 — неподвижное + распашная дверь

const baseInputs = {
  tier: tier.value,
  model,
  width: 900,
  width2: 0,
  height: 2000,
  glassCostPerM2: 3000,
  glassName: 'Стекло прозрачное',
  thickness: 8 as const,
  hardwareColor: 'chrome',
  hardwareColorMultiplier: 1.0,
  withMounting: false,
  withDelivery: false,
  floors: 1,
  discount: 0,
  partnerPercent: 0,
  margin: 30,
  expensesPercent: tier.expensesPercent,
  hwTierMultiplier: tier.hwMultiplier,
}

describe('calculateShower', () => {
  it('возвращает результат для базовой душевой', () => {
    const result = calculateShower(baseInputs, [])
    expect(result.finalPrice).toBeGreaterThan(0)
    expect(result.grandTotal).toBeGreaterThan(0)
    expect(result.totalCost).toBeGreaterThan(0)
  })

  // INV-1: grandTotal === finalPrice без услуг
  it('INV-1: grandTotal === finalPrice без доп. услуг', () => {
    const result = calculateShower(baseInputs, [])
    expect(result.grandTotal).toBe(result.finalPrice)
  })

  // INV-1: grandTotal включает услуги
  it('INV-1: grandTotal = finalPrice + servicesTotal', () => {
    const inputs = { ...baseInputs, withMounting: true, withDelivery: true }
    const result = calculateShower(inputs, [mockShowerInstallService, mockShowerDeliveryService])
    expect(result.grandTotal).toBe(result.finalPrice + result.servicesTotal)
    expect(result.servicesTotal).toBeGreaterThan(0)
  })

  // INV-4: profit от finalPrice, не grandTotal
  it('INV-4: profit не включает стоимость услуг', () => {
    const inputs = { ...baseInputs, withMounting: true, withDelivery: true }
    const result = calculateShower(inputs, [mockShowerInstallService, mockShowerDeliveryService])
    expect(result.profit).toBeLessThan(result.grandTotal - result.totalCost)
  })

  it('скидка уменьшает finalPrice', () => {
    const r0  = calculateShower(baseInputs, [])
    const r15 = calculateShower({ ...baseInputs, discount: 15 }, [])
    expect(r15.finalPrice).toBeLessThan(r0.finalPrice)
    expect(r15.discountAmount).toBeGreaterThan(0)
  })

  it('маржа влияет на итоговую цену', () => {
    const r30 = calculateShower(baseInputs, [])
    const r50 = calculateShower({ ...baseInputs, margin: 50 }, [])
    expect(r50.finalPrice).toBeGreaterThan(r30.finalPrice)
  })

  it('угловая модель (corner) учитывает width2', () => {
    const cornerModel = SHOWER_MODELS[3] // M4 — corner
    const r = calculateShower({ ...baseInputs, model: cornerModel, width2: 800 }, [])
    expect(r.glassArea).toBeGreaterThan(0)
  })

  it('belowMinMargin флаг при низкой марже', () => {
    const result = calculateShower({ ...baseInputs, margin: 5, minMargin: 25 }, [])
    expect(result.belowMinMargin).toBe(true)
  })
})
