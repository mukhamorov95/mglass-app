import { NextResponse, type NextRequest } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { createClient } from '@/lib/supabase-server'
import { getKitStore, saveLibrary, saveKit, saveAllKits, libraryUpdatedAt } from '@/lib/configurator/kitStore'
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
    kits?: Record<string, ModelKit>
    baseUpdatedAt?: string | null
  } | null
  if (!body || !isTier(body.tier ?? null)) return NextResponse.json({ error: 'tier обязателен' }, { status: 400 })
  const tier = body.tier as Tier

  if (body.library && !Array.isArray(body.library.items)) return NextResponse.json({ error: 'library.items — массив' }, { status: 400 })
  if (body.library?.items.some(i => !i.id || !i.name || !isRole(i.role))) {
    return NextResponse.json({ error: 'у позиции нужны id, name и известная роль' }, { status: 400 })
  }
  const validKit = (code: string, kit: ModelKit) =>
    M_MODELS.some(m => m.code === code) && Array.isArray(kit.slots) && !kit.slots.some(s => !isRole(s.role))
  if (body.kit) {
    if (!body.code || !validKit(body.code, body.kit)) return NextResponse.json({ error: 'code/kit: М1…М12 + слоты с известной ролью' }, { status: 400 })
  }
  if (body.kits) {
    for (const [code, kit] of Object.entries(body.kits)) {
      if (!validKit(code, kit)) return NextResponse.json({ error: `kits[${code}]: неизвестная модель или роль` }, { status: 400 })
    }
  }

  // Вкладка пишет библиотеку и комплекты целиком. Открытая до чужого сохранения (переоценка,
  // чистка, другой человек) затёрла бы его молча — поэтому сверяем, с какой версии она начинала.
  // Вкладка, открытая до этой защиты, версию не присылает — ей тоже нужно обновиться.
  if (body.library || body.kits) {
    const current = await libraryUpdatedAt(tier)
    if (current && (!body.baseUpdatedAt || new Date(current).getTime() > new Date(body.baseUpdatedAt).getTime())) {
      return NextResponse.json({ error: 'Прайс изменили после того, как вы открыли страницу. Обновите страницу — ваши правки не сохранены.', conflict: true }, { status: 409 })
    }
  }

  const { data: { user } } = await (await createClient()).auth.getUser()
  const by = user?.email ?? 'owner'
  let updatedAt: string | null = null
  if (body.library && body.rates) updatedAt = await saveLibrary(tier, body.library, body.rates, by)
  if (body.kits) await saveAllKits(tier, body.kits, by)          // все комплекты разом («во все модели», копирование тарифа)
  else if (body.kit && body.code) await saveKit(tier, body.code, body.kit, by)
  return NextResponse.json({ ok: true, updatedAt })
}
