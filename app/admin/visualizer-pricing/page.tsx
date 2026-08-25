import { getKitStore } from '@/lib/configurator/kitStore'
import { getFinance, type Finance } from '@/lib/configurator/financeStore'
import { KitPricingClient, type TierStore } from './KitPricingClient'
import type { Tier } from '@/lib/configurator/pricing'

// Прайс душевых: комплект под каждую модель М1…М12 по тарифам Бюджет/Премиум.
// Доступ — owner-tier и закупщик (гейт в middleware/getRole для /admin/*).
export const metadata = { title: 'Прайс душевых — M-Glass' }

export default async function Page() {
  const [budget, premium, finBudget, finPremium] = await Promise.all([
    getKitStore('budget'), getKitStore('premium'), getFinance('budget'), getFinance('premium'),
  ])
  const initial: Record<Tier, TierStore> = {
    budget: { library: budget.library, rates: budget.rates, kits: budget.kits },
    premium: { library: premium.library, rates: premium.rates, kits: premium.kits },
  }
  const finance: Record<Tier, Finance> = { budget: finBudget, premium: finPremium }
  return <KitPricingClient initial={initial} finance={finance} />
}
