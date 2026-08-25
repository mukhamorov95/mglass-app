import { getKitStore } from '@/lib/configurator/kitStore'
import { KitPricingClient, type TierStore } from './KitPricingClient'
import type { Tier } from '@/lib/configurator/pricing'

// Прайс душевых: комплект под каждую модель М1…М12 по тарифам Бюджет/Премиум.
// Доступ — owner-tier и закупщик (гейт в middleware/getRole для /admin/*).
export const metadata = { title: 'Прайс душевых — M-Glass' }

export default async function Page() {
  const [budget, premium] = await Promise.all([getKitStore('budget'), getKitStore('premium')])
  const initial: Record<Tier, TierStore> = {
    budget: { library: budget.library, rates: budget.rates, kits: budget.kits },
    premium: { library: premium.library, rates: premium.rates, kits: premium.kits },
  }
  return <KitPricingClient initial={initial} />
}
