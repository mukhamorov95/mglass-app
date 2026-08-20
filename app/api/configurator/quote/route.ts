import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { getPricing } from '@/lib/configurator/pricingStore'
import { getModel, M_MODELS } from '@/lib/configurator/arrangement'
import { buildFromModel, type MDims } from '@/components/configurator/scene/assembly'
import { computeQuantities, computePrice, clientPriceFrom, DEFAULT_FINANCE, type Tier } from '@/lib/configurator/pricing'

// Серверный расчёт цены визуализатора. Себестоимость и ставки НЕ уходят в браузер:
// неавторизованному (публичный embed) отдаём только сумму «от N ₽»; авторизованному
// менеджеру/владельцу — полную разбивку. Цены — из Supabase (админка), фолбэк — дефолты.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as {
    model?: string; dims?: MDims; thickness?: number; tier?: string; glassType?: string; finishId?: string; withDelivery?: boolean; floors?: number; choice?: Record<string, string>
  } | null
  if (!body?.model || !body.dims || !M_MODELS.some(m => m.code === body.model)) {
    return NextResponse.json({ error: 'model + dims обязательны' }, { status: 400 })
  }
  const tier: Tier = body.tier === 'premium' ? 'premium' : 'budget'
  const thickness = body.thickness ?? 8

  const prices = await getPricing(tier)
  const assembly = buildFromModel(getModel(body.model), body.dims, thickness)
  const q = computeQuantities(assembly, thickness)
  const price = computePrice(q, prices, DEFAULT_FINANCE, {
    glassType: body.glassType, finishId: body.finishId, withDelivery: body.withDelivery, floors: body.floors, choice: body.choice,
  })

  const { data: { user } } = await (await createClient()).auth.getUser()
  if (user) {
    // Авторизованный (менеджер/владелец) — полная разбивка себестоимости.
    return NextResponse.json({ full: true, price })
  }
  // Публичный embed — только клиентская цена, без себестоимости.
  return NextResponse.json({ full: false, total: price.total, clientFrom: clientPriceFrom(price.total) })
}
