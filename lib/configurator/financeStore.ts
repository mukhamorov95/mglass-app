import 'server-only'
import { createServiceClient } from '@/lib/supabase-service'
import type { Tier } from '@/lib/configurator/pricing'

// Маржа и налог для прайса душевых берутся из financial_settings, а не из кода.
// Владелец меняет процент в одном месте — цена меняется везде: и в админке, и у клиента.
// Тариф визуализатора → product_type в настройках: бюджет = shower_budget, премиум = shower_standard.

export type Finance = { marginPct: number; taxPct: number; minMarginPct: number; source: string }
export const FINANCE_FALLBACK: Finance = { marginPct: 40, taxPct: 12, minMarginPct: 25, source: 'дефолт кода' }

const PRODUCT_TYPE: Record<Tier, string> = { budget: 'shower_budget', premium: 'shower_standard' }

export async function getFinance(tier: Tier): Promise<Finance> {
  try {
    const supa = createServiceClient()
    const { data } = await supa.from('financial_settings')
      .select('tier, product_type, tax_percent, default_margin, min_margin')
    const rows = data ?? []
    const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d)
    // Сначала строка под конкретный продукт, потом общая строка тарифа, потом любая общая.
    const byProduct = rows.find(r => r.product_type === PRODUCT_TYPE[tier])
    const byTier = rows.find(r => !r.product_type && r.tier === (tier === 'budget' ? 'budget' : 'standard'))
    const any = rows.find(r => !r.product_type)
    const row = byProduct ?? byTier ?? any
    if (!row) return FINANCE_FALLBACK
    return {
      marginPct: num(row.default_margin, FINANCE_FALLBACK.marginPct),
      taxPct: num(row.tax_percent, FINANCE_FALLBACK.taxPct),
      minMarginPct: num(row.min_margin, FINANCE_FALLBACK.minMarginPct),
      source: row.product_type ? `financial_settings · ${row.product_type}` : `financial_settings · ${row.tier}`,
    }
  } catch {
    return FINANCE_FALLBACK
  }
}
