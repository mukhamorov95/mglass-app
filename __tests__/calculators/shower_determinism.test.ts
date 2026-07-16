import { describe, it, expect } from 'vitest'
import { calculateShower, SHOWER_MODELS, TIER_CONFIGS, HARDWARE_COLORS } from '@/lib/showerCalculator'
import {
  resolveShowerGlassCostPerM2, resolveShowerExpensesPercent, resolveBudgetHardwareCost,
  type GlassMatrixMap, type FinSettingRow,
} from '@/lib/pricing/showerInputs'

// Значения — как в проде на 16.07.2026 (проверено read-only скриптом).
const GLASS_MATRIX: GlassMatrixMap = { 'Прозрачное М1': { t8: 3258 } }
const FIN: FinSettingRow[] = [
  { product_type: 'shower_budget',   tier: 'budget',   tax_percent: 12 },
  { product_type: 'shower_standard', tier: 'standard', tax_percent: 12 },
]
const HW_COLORS = [{ id: 1, name: 'ХРОМ' }]

describe('резолверы входов душевой', () => {
  it('стекло берётся из glass_price_matrix (sale t8)', () => {
    expect(resolveShowerGlassCostPerM2(GLASS_MATRIX, 'М1 прозрачное', 8, [])).toBe(3258)
  })
  it('расходы берутся из financial_settings (не из константы тарифа 33%)', () => {
    expect(resolveShowerExpensesPercent(FIN, 'budget')).toBe(12)
    expect(resolveShowerExpensesPercent(FIN, 'standard')).toBe(12)
  })
  it('фолбэк расходов = 12 при отсутствии строки', () => {
    expect(resolveShowerExpensesPercent([], 'budget')).toBe(12)
  })
  it('фурнитура бюджета: формула когда цена не задана', () => {
    expect(resolveBudgetHardwareCost([], HW_COLORS, 'M2', 'chrome')).toBeUndefined()
  })
  it('фурнитура бюджета: ручная цена когда задана Верой', () => {
    expect(resolveBudgetHardwareCost([{ model_id: 'M2', color_id: 1, price: 9500 }], HW_COLORS, 'M2', 'chrome')).toBe(9500)
  })
})

describe('golden: цена AI (Иван) == цена живого калькулятора', () => {
  it('M2 900×2000 бюджет хром = 28 467 ₽', () => {
    const model   = SHOWER_MODELS.find(m => m.id === 'M2')!
    const tierCfg = TIER_CONFIGS.find(t => t.value === 'budget')!
    const color   = HARDWARE_COLORS.find(c => c.value === 'chrome')!

    const glassCostPerM2     = resolveShowerGlassCostPerM2(GLASS_MATRIX, 'М1 прозрачное', 8, [])
    const expensesPercent    = resolveShowerExpensesPercent(FIN, 'budget')
    const customHardwareCost = resolveBudgetHardwareCost([], HW_COLORS, 'M2', 'chrome')

    const res = calculateShower({
      tier: 'budget', model, width: 900, width2: 900, height: 2000,
      glassCostPerM2, glassName: 'М1 прозрачное', thickness: 8,
      hardwareColor: 'chrome', hardwareColorMultiplier: color.multiplier,
      withMounting: false, withDelivery: false, floors: 0, discount: 0, partnerPercent: 0,
      margin: 40, expensesPercent, hwTierMultiplier: tierCfg.hwMultiplier,
      customHardwareCost, minMargin: 25, standardMargin: 40,
    }, [])

    expect(res.glassCost).toBe(5864)     // 3258 × 1.8 м²
    expect(res.hardwareCost).toBe(7800)  // 13000 × 0.6 × 1.0
    expect(res.totalCost).toBe(13664)
    expect(res.finalPrice).toBe(28467)   // 13664 / (1 − 0.12 − 0.40)
  })
})
