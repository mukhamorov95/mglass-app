import { getAllPricing } from '@/lib/configurator/pricingStore'
import { VisualizerPricingClient } from './VisualizerPricingClient'

// Себестоимость визуализатора: справочник цен по тарифам Бюджет/Премиум.
// Доступ — только owner-tier (гейт в middleware/getRole для /admin/*).
export const metadata = { title: 'Себестоимость визуализатора — M-Glass' }

export default async function Page() {
  const initial = await getAllPricing()
  return <VisualizerPricingClient initial={initial} />
}
