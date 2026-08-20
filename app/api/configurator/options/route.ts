import { NextResponse, type NextRequest } from 'next/server'
import { getPricing } from '@/lib/configurator/pricingStore'
import { selectableOptions, type Tier } from '@/lib/configurator/pricing'

// Публичный: варианты фурнитуры для выбора клиентом (петля/ручка) по тарифу.
// Отдаёт ТОЛЬКО key/name/shape — себестоимость не уходит в браузер (embed-safe).
export async function GET(req: NextRequest) {
  const tier: Tier = req.nextUrl.searchParams.get('tier') === 'premium' ? 'premium' : 'budget'
  const up = await getPricing(tier)
  return NextResponse.json({ tier, options: selectableOptions(up) })
}
