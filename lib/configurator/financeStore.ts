import 'server-only'
import { createServiceClient } from '@/lib/supabase-service'
import type { Tier } from '@/lib/configurator/pricing'
import { FINANCE_FALLBACK, pickFinance, type Finance, type FinanceRow } from '@/lib/pricing/pickFinance'

// Маржа и налог для прайса душевых берутся из financial_settings, а не из кода.
// Владелец меняет процент в одном месте — цена меняется везде: и в админке, и у клиента.
// Тариф визуализатора → product_type в настройках: бюджет = shower_budget, премиум = shower_standard.

export { FINANCE_FALLBACK, type Finance }

const PRODUCT_TYPE: Record<Tier, string> = { budget: 'shower_budget', premium: 'shower_standard' }

export async function getFinance(tier: Tier): Promise<Finance> {
  try {
    const supa = createServiceClient()
    const { data } = await supa.from('financial_settings')
      .select('tier, product_type, tax_percent, default_margin, min_margin')
    return pickFinance((data ?? []) as FinanceRow[], PRODUCT_TYPE[tier], tier === 'budget' ? 'budget' : 'standard')
  } catch {
    return FINANCE_FALLBACK
  }
}
