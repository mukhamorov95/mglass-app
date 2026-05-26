import { describe, it, expect } from 'vitest'
import { calculateLoft } from '@/lib/loftCalculator'
import {
  mockGlassMaterial,
  mockProfileMaterial,
  mockInstallService,
  mockDeliveryService,
  mockFinancialSettings,
} from './fixtures'

const baseInputs = {
  width: 2000,       // 2м
  height: 2400,      // 2.4м
  sections: 2,
  divisions: 0,
  systemType: 'fixed' as const,
  glassMaterial: mockGlassMaterial,
  glassWastePct: 10,
  glassCalcPrice: 1800,
  withTempering: false,
  withMirrorFilm: false,
  withPainting: false,
  hasInstallation: false,
  hasDelivery: false,
  hardware: [],
  hardwareQty: {},
  partnerPercent: 0,
  discount: 0,
  margin: 30,
}

const materials = [mockGlassMaterial, mockProfileMaterial]
const services  = [mockInstallService, mockDeliveryService]

describe('calculateLoft', () => {
  it('возвращает результат для базовой перегородки', () => {
    const result = calculateLoft(baseInputs, materials, services, mockFinancialSettings)
    expect(result).not.toBeNull()
    expect(result!.finalPrice).toBeGreaterThan(0)
    expect(result!.grandTotal).toBeGreaterThan(0)
  })

  // INV-1: grandTotal === finalPrice без услуг
  it('INV-1: grandTotal === finalPrice когда нет доп. услуг', () => {
    const result = calculateLoft(baseInputs, materials, [], mockFinancialSettings)
    expect(result!.grandTotal).toBe(result!.finalPrice)
  })

  // INV-1: grandTotal включает услуги
  it('INV-1: grandTotal = finalPrice + servicesTotal', () => {
    const inputs = { ...baseInputs, hasInstallation: true, hasDelivery: true }
    const result = calculateLoft(inputs, materials, services, mockFinancialSettings)
    expect(result!.grandTotal).toBe(result!.finalPrice + result!.servicesTotal)
  })

  // INV-4: profit не включает услуги
  it('INV-4: profit считается от finalPrice, не grandTotal', () => {
    const inputs = { ...baseInputs, hasInstallation: true, hasDelivery: true }
    const result = calculateLoft(inputs, materials, services, mockFinancialSettings)
    expect(result!.profit).toBeLessThan(result!.grandTotal - result!.totalCost)
  })

  it('нулевые размеры → возвращает null', () => {
    const result = calculateLoft({ ...baseInputs, width: 0, height: 0 }, materials, services, mockFinancialSettings)
    expect(result).toBeNull()
  })

  it('скидка уменьшает finalPrice', () => {
    const r0  = calculateLoft(baseInputs, materials, [], mockFinancialSettings)
    const r15 = calculateLoft({ ...baseInputs, discount: 15 }, materials, [], mockFinancialSettings)
    expect(r15!.finalPrice).toBeLessThan(r0!.finalPrice)
  })

  it('больше секций — больше профиля (металла)', () => {
    const r1 = calculateLoft({ ...baseInputs, sections: 1 }, materials, [], mockFinancialSettings)
    const r3 = calculateLoft({ ...baseInputs, sections: 3 }, materials, [], mockFinancialSettings)
    // Больше секций = больше вертикальных стоек = больше металла
    expect(r3!.metalLength).toBeGreaterThan(r1!.metalLength)
  })
})
