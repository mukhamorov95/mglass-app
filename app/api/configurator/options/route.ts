import { NextResponse, type NextRequest } from 'next/server'
import { getKitStore } from '@/lib/configurator/kitStore'
import { getModel, M_MODELS } from '@/lib/configurator/arrangement'
import { computeKitQuantities, kitChoices } from '@/lib/configurator/kit'
import type { Tier } from '@/lib/configurator/pricing'
import { buildWithVariant, type QuoteRequest, type OptionsResponse } from '@/lib/configurator/quoteContract'

// Что предложить клиенту на выбор: варианты позиций по ролям (★ первой) и допустимые
// количества. Публичный маршрут — себестоимости здесь нет и быть не должно.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as QuoteRequest | null
  if (!body?.model || !body.dims || !M_MODELS.some(m => m.code === body.model)) {
    return NextResponse.json({ error: 'model + dims обязательны' }, { status: 400 })
  }
  const tier: Tier = body.tier === 'premium' ? 'premium' : 'budget'
  const thickness = body.thickness ?? 8
  const model = getModel(body.model)

  const { library, rates, kits } = await getKitStore(tier)
  const assembly = buildWithVariant(model, body.dims, thickness, body.variant)
  const q = computeKitQuantities(assembly, thickness, model, rates.capMargin)
  const res: OptionsResponse = kitChoices(library, kits[body.model] ?? { slots: [] }, q)
  return NextResponse.json(res)
}
