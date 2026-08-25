import { NextResponse, type NextRequest } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { createClient } from '@/lib/supabase-server'
import { getKitStore, saveLibrary, saveKit } from '@/lib/configurator/kitStore'
import { isRole, type Library, type ModelKit, type KitRates } from '@/lib/configurator/kit'
import { M_MODELS } from '@/lib/configurator/arrangement'
import type { Tier } from '@/lib/configurator/pricing'

const isTier = (t: string | null): t is Tier => t === 'budget' || t === 'premium'
// Прайс ведут владелец и логист-закупщик (buyer).
const ALLOWED = ['admin', 'ceo', 'buyer'] as const

export async function GET(req: NextRequest) {
  const guard = await requireRole([...ALLOWED])
  if (guard instanceof NextResponse) return guard
  const tier = req.nextUrl.searchParams.get('tier')
  if (!isTier(tier)) return NextResponse.json({ error: 'tier: budget|premium' }, { status: 400 })
  return NextResponse.json({ tier, ...(await getKitStore(tier)) })
}

// Сохраняем библиотеку и комплект модели одним запросом: цену позиции владелец правит
// там же, где собирает комплект, — иначе половина изменений теряется при переключении модели.
export async function PUT(req: NextRequest) {
  const guard = await requireRole([...ALLOWED])
  if (guard instanceof NextResponse) return guard
  const body = await req.json().catch(() => null) as {
    tier?: string; library?: Library; rates?: KitRates; code?: string; kit?: ModelKit
  } | null
  if (!body || !isTier(body.tier ?? null)) return NextResponse.json({ error: 'tier обязателен' }, { status: 400 })
  const tier = body.tier as Tier

  if (body.library && !Array.isArray(body.library.items)) return NextResponse.json({ error: 'library.items — массив' }, { status: 400 })
  if (body.library?.items.some(i => !i.id || !i.name || !isRole(i.role))) {
    return NextResponse.json({ error: 'у позиции нужны id, name и известная роль' }, { status: 400 })
  }
  if (body.kit) {
    if (!body.code || !M_MODELS.some(m => m.code === body.code)) return NextResponse.json({ error: 'code: М1…М12' }, { status: 400 })
    if (!Array.isArray(body.kit.slots) || body.kit.slots.some(s => !isRole(s.role))) {
      return NextResponse.json({ error: 'kit.slots — массив слотов с известной ролью' }, { status: 400 })
    }
  }

  const { data: { user } } = await (await createClient()).auth.getUser()
  const by = user?.email ?? 'owner'
  if (body.library && body.rates) await saveLibrary(tier, body.library, body.rates, by)
  if (body.kit && body.code) await saveKit(tier, body.code, body.kit, by)
  return NextResponse.json({ ok: true })
}
