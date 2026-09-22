// Выбор строки financial_settings для продукта — чистая функция без Supabase.
// Порядок: строка под конкретный product_type, потом общая строка тарифа, потом
// любая общая строка, и только потом дефолт кода. Источник подписывается, чтобы
// экран показывал, откуда взялся процент.

export type Finance = { marginPct: number; taxPct: number; minMarginPct: number; source: string }
export const FINANCE_FALLBACK: Finance = { marginPct: 40, taxPct: 12, minMarginPct: 25, source: 'дефолт кода' }

export type FinanceRow = {
  tier: string | null
  product_type: string | null
  tax_percent: number | string | null
  default_margin: number | string | null
  min_margin: number | string | null
}

export function pickFinance(rows: FinanceRow[], productType: string, tier: 'budget' | 'standard'): Finance {
  const num = (v: unknown, d: number) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d)
  const byProduct = rows.find(r => r.product_type === productType)
  const byTier = rows.find(r => !r.product_type && r.tier === tier)
  const any = rows.find(r => !r.product_type)
  const row = byProduct ?? byTier ?? any
  if (!row) return FINANCE_FALLBACK
  return {
    marginPct: num(row.default_margin, FINANCE_FALLBACK.marginPct),
    taxPct: num(row.tax_percent, FINANCE_FALLBACK.taxPct),
    minMarginPct: num(row.min_margin, FINANCE_FALLBACK.minMarginPct),
    source: row.product_type ? `financial_settings · ${row.product_type}` : `financial_settings · ${row.tier}`,
  }
}
