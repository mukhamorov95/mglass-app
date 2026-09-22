import { describe, expect, it } from 'vitest'
import { mirrorFinanceProductType } from '@/lib/mirror/mirrorFinance'
import { FINANCE_FALLBACK, pickFinance, type FinanceRow } from '@/lib/pricing/pickFinance'

// Строки как в проде на 22.09.2026: у зеркала с подсветкой своя строка 50%,
// но владелец решил считать все зеркала по строке mirror (40%).
const ROWS: FinanceRow[] = [
  { tier: 'standard', product_type: null, tax_percent: '12.00', default_margin: '40.00', min_margin: '25.00' },
  { tier: 'budget', product_type: null, tax_percent: '12.00', default_margin: '40.00', min_margin: '25.00' },
  { tier: 'standard', product_type: 'mirror', tax_percent: '12.00', default_margin: '40.00', min_margin: '25.00' },
  { tier: 'standard', product_type: 'mirror_light', tax_percent: '12.00', default_margin: '50.00', min_margin: '30.00' },
  { tier: 'standard', product_type: 'loft', tax_percent: '12.00', default_margin: '50.00', min_margin: '30.00' },
]

describe('маржа зеркала из financial_settings', () => {
  it.each(['none', 'aura', 'front', 'both'] as const)('подсветка %s → строка mirror', mode => {
    expect(mirrorFinanceProductType(mode)).toBe('mirror')
  })

  it('зеркало с подсветкой берёт 40% из строки mirror, а не 50% из mirror_light', () => {
    const f = pickFinance(ROWS, mirrorFinanceProductType('aura'), 'standard')
    expect(f).toEqual({ marginPct: 40, taxPct: 12, minMarginPct: 25, source: 'financial_settings · mirror' })
  })

  it('нет строки продукта → общая строка тарифа', () => {
    const rows = ROWS.filter(r => r.product_type !== 'mirror')
    const f = pickFinance(rows, 'mirror', 'standard')
    expect(f.source).toBe('financial_settings · standard')
    expect(f.marginPct).toBe(40)
  })

  it('пустая таблица → дефолт кода с подписью источника', () => {
    expect(pickFinance([], 'mirror', 'standard')).toEqual(FINANCE_FALLBACK)
  })

  it('пустое значение в строке не превращается в 0%', () => {
    const rows: FinanceRow[] = [{ tier: 'standard', product_type: 'mirror', tax_percent: null, default_margin: '', min_margin: null }]
    const f = pickFinance(rows, 'mirror', 'standard')
    expect(f.marginPct).toBe(FINANCE_FALLBACK.marginPct)
    expect(f.taxPct).toBe(FINANCE_FALLBACK.taxPct)
  })
})
