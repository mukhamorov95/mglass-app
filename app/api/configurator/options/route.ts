import { NextResponse, type NextRequest } from 'next/server'
import { getKitStore } from '@/lib/configurator/kitStore'
import { getModel, M_MODELS } from '@/lib/configurator/arrangement'
import { computeKitQuantities, kitChoices, ROLE_META, inferShapeOf } from '@/lib/configurator/kit'
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

  const { library, kits } = await getKitStore(tier)
  const assembly = buildWithVariant(model, body.dims, thickness, body.variant)
  const q = computeKitQuantities(assembly, thickness, model)
  const res: OptionsResponse = kitChoices(library, kits[body.model] ?? { slots: [] }, q)
  return NextResponse.json(res)
}

// Совместимость: старый визуализатор спрашивает варианты одним GET по тарифу и ждёт
// {options: {роль: [{key,name,shape}]}}. Отдаём то же самое из комплектов моделей,
// пока клиентский UI не перейдёт на POST с моделью и вариантом.
export async function GET(req: NextRequest) {
  const tier: Tier = req.nextUrl.searchParams.get('tier') === 'premium' ? 'premium' : 'budget'
  const code = req.nextUrl.searchParams.get('model')
  const { library, kits } = await getKitStore(tier)
  const byId = new Map(library.items.map(i => [i.id, i]))
  const slots = (code ? [kits[code]] : Object.values(kits)).flatMap(k => k?.slots ?? [])

  const options: Record<string, { key: string; name: string; shape: string }[]> = {}
  for (const slot of slots) {
    if (slot.select !== 'one' || ROLE_META[slot.role].kind !== 'piece') continue
    const list = options[slot.role] ??= []
    for (const e of [...slot.entries].sort((a, b) => Number(b.primary) - Number(a.primary))) {
      const it = byId.get(e.itemId)
      if (!it || list.some(o => o.key === it.id)) continue
      list.push({ key: it.id, name: it.name, shape: inferShapeOf(it) })
    }
  }
  for (const role of Object.keys(options)) if (options[role].length < 2) delete options[role]
  return NextResponse.json({ tier, options })
}
