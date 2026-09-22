import { describe, it, expect } from 'vitest'
import { calculateMirrorUnified } from '@/lib/pricing/calculateMirrorUnified'

// Пескоструй: цену берём из справочника материалов (строка со словом «Пескоструй»).
// Сборка «с пескоструем» — другая позиция: это работа сборки, не сам рисунок.
const mat = (over: Record<string, unknown>) => ({
  id: 1, name: '', short_name: null, category: 'зеркало', unit: 'м²',
  cost_price: 0, sale_price: null, active: true, ...over,
}) as never

const base = {
  width: 1000, height: 1000, shape: 'rectangle' as const,
  mirrorMaterial: mat({ id: 10, name: 'Зеркало Осветлённое 4 мм', cost_price: 1000 }),
  mirrorCostPriceCostRow: null,
  hasLighting: false, voltage: 12 as const, lightingLengthM: 0,
  frame: null, ledStrip: null, powerSupply: null, diffuser: null,
  buttonType: 'none' as const, hasSandblast: true,
  hasSubstrate: false, substratePrice: 0,
  hasFacet: false, facetTypeMm: null, facetCostPerM: 0,
  hasInstallation: false, hasDelivery: false,
  partnerPercent: 0, discount: 0,
  margin: 40, standardMargin: 40, tax: 12, minMargin: 0,
}

const sandblastLine = (lines: { name: string; total: number }[]) =>
  lines.find(l => /^пескостру/i.test(l.name)) ?? null

describe('пескоструй в расчёте изделия', () => {
  it('цена берётся из строки справочника', () => {
    const res = calculateMirrorUnified(base, [
      base.mirrorMaterial,
      mat({ id: 97, name: 'Сборка зеркала с пескоструем', unit: 'шт', cost_price: 1500 }),
      mat({ id: 98, name: 'Пескоструй', unit: 'м²', cost_price: 900 }),
    ], [])!
    const sb = sandblastLine(res.costLines)
    expect(sb).not.toBeNull()
    expect(sb!.total).toBe(900)  // 1 м² × 900 ₽
  })

  it('без строки в справочнике пескоструй в себестоимость не попадает вовсе', () => {
    const res = calculateMirrorUnified(base, [
      base.mirrorMaterial,
      mat({ id: 97, name: 'Сборка зеркала с пескоструем', unit: 'шт', cost_price: 1500 }),
    ], [])!
    expect(sandblastLine(res.costLines)).toBeNull()
    // «Сборка зеркала с пескоструем» — это сборка, она за пескоструй не отвечает
    expect(res.costLines.some(l => l.name === 'Сборка зеркала с пескоструем')).toBe(true)
  })
})
