import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { getKitStore } from '@/lib/configurator/kitStore'
import { getModel, M_MODELS } from '@/lib/configurator/arrangement'
import { computeKitQuantities, computeKitPrice, type RoleId } from '@/lib/configurator/kit'
import { clientPriceFrom, DEFAULT_FINANCE, type Tier } from '@/lib/configurator/pricing'
import { buildWithVariant, type QuoteRequest, type QuoteResponse } from '@/lib/configurator/quoteContract'

// Серверный расчёт цены визуализатора по КОМПЛЕКТУ модели. Себестоимость и ставки не
// уходят в браузер: неавторизованному (публичный embed) — только сумма «от N ₽»,
// авторизованному менеджеру/владельцу — полная разбивка.
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
  const price = computeKitPrice(q, library, kits[body.model] ?? { slots: [] }, rates, DEFAULT_FINANCE, {
    glassType: body.glassType, finishId: body.finishId, withDelivery: body.withDelivery, floors: body.floors,
    choice: body.choice as Partial<Record<RoleId, string>> | undefined,
    qtyChoice: body.qtyChoice as Partial<Record<RoleId, number>> | undefined,
  })

  const { data: { user } } = await (await createClient()).auth.getUser()
  const res: QuoteResponse = user
    ? { full: true, price }
    : { full: false, total: price.total, clientFrom: clientPriceFrom(price.total), complete: price.complete }
  return NextResponse.json(res)
}
