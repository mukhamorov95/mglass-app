import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { requireRole } from '@/lib/apiAuth'

export const dynamic = 'force-dynamic'

// Себестоимость зеркал: роль → позиция из прайса поставщика → цена.
// Тот же принцип, что у душевых (роль → позиция → цена), но источник цены —
// прайс Eleganz: он уже ведётся и пересчитывается по курсу ЦБ, поэтому руками
// цены не вводим. Прайс в долларах, поэтому фиксируем рубли на момент выбора и
// пересчитываем кнопкой — иначе цена расчёта менялась бы сама по себе.

const ALLOWED = ['admin', 'ceo', 'buyer'] as const

// Какие категории прайса подходят каждой роли зеркала. Список категорий —
// данные поставщика, поэтому сопоставление по вхождению, а не по равенству.
export const ROLE_SOURCES: { role: string; label: string; match: string[]; hint: string }[] = [
  { role: 'led_strip',    label: 'LED-лента',              match: ['LED ленты'],                 hint: 'бухта 5 м · укажите Вт/м' },
  { role: 'diffuser',     label: 'Профиль с рассеивателем', match: ['Профили'],                  hint: 'хлыст 6 м' },
  { role: 'power_supply', label: 'Блок питания',           match: ['Блоки питания'],             hint: 'укажите макс. мощность' },
  { role: 'sensor',       label: 'Сенсорный выключатель',  match: ['Сенсорные выключатели'],     hint: '' },
  { role: 'button',       label: 'Кнопка',                 match: ['Мебельное освещение', 'Сенсорные выключатели'], hint: '' },
  { role: 'dimmer',       label: 'Диммер / контроллер',    match: ['Контроллеры и диммеры'],     hint: '' },
  { role: 'heating',      label: 'Подогрев / реле',        match: ['Подогрев и реле'],           hint: 'антизапотевание' },
  { role: 'wire',         label: 'Провод',                 match: ['Мебельное освещение'],       hint: 'цена за метр' },
  { role: 'connector',    label: 'Коннекторы',             match: ['Мебельное освещение'],       hint: '' },
]

async function rateRub(req: NextRequest): Promise<number> {
  // Курс ЦБ + 2 ₽ — то же правило, что на экране прайса Eleganz.
  try {
    const r = await fetch(new URL('/api/cbr-rate', req.nextUrl.origin), { cache: 'no-store' })
    const j = await r.json().catch(() => ({}))
    const rate = Number(j?.rate)
    if (Number.isFinite(rate) && rate > 0) return rate + 2
  } catch { /* курс недоступен — ниже фолбэк */ }
  return 0
}

export async function GET(req: NextRequest) {
  const guard = await requireRole([...ALLOWED])
  if (guard instanceof NextResponse) return guard
  const svc = createServiceClient()

  const [{ data: comps }, { data: price }] = await Promise.all([
    svc.from('mirror_lighting_components')
      .select('id, component_type, name, unit, cost_price, active, voltage, power_per_meter, max_power, pack_length_m, source_supplier, source_item_id, price_updated_at')
      .order('component_type').order('sort_order'),
    svc.from('supplier_price_items')
      .select('id, category, name, article, price_usd, price_rub, currency, unit')
      .eq('supplier', 'eleganz').eq('active', true)
      .order('category').order('sort_order'),
  ])

  const rate = await rateRub(req)
  return NextResponse.json({
    roles: ROLE_SOURCES,
    components: comps ?? [],
    priceItems: price ?? [],
    rate,
  }, { headers: { 'Cache-Control': 'no-store' } })
}

// Взять позицию из прайса в справочник зеркал (или обновить цену выбранных).
export async function POST(req: NextRequest) {
  const guard = await requireRole([...ALLOWED])
  if (guard instanceof NextResponse) return guard
  const svc = createServiceClient()

  const b = await req.json().catch(() => ({})) as {
    action?: 'pick' | 'refresh'
    role?: string; item_id?: number
    voltage?: number | null; power_per_meter?: number | null; max_power?: number | null; pack_length_m?: number | null
  }
  const rate = await rateRub(req)
  if (!rate) return NextResponse.json({ error: 'Курс ЦБ недоступен — цена в рублях не считается' }, { status: 503 })

  const rub = (it: { price_usd: number | null; price_rub: number | null; currency: string | null }) =>
    it.currency === 'RUB' || it.price_usd == null
      ? Math.round(Number(it.price_rub) || 0)
      : Math.round(Number(it.price_usd) * rate)

  if (b.action === 'refresh') {
    // Пересчёт рублёвых цен всех связанных позиций по текущему курсу.
    const { data: linked } = await svc.from('mirror_lighting_components')
      .select('id, source_item_id').not('source_item_id', 'is', null)
    const ids = (linked ?? []).map(l => Number(l.source_item_id))
    if (ids.length === 0) return NextResponse.json({ ok: true, updated: 0 })
    const { data: items } = await svc.from('supplier_price_items')
      .select('id, price_usd, price_rub, currency').in('id', ids)
    const byId = new Map((items ?? []).map(i => [Number(i.id), i]))
    let updated = 0
    for (const l of linked ?? []) {
      const it = byId.get(Number(l.source_item_id))
      if (!it) continue
      await svc.from('mirror_lighting_components')
        .update({ cost_price: rub(it), price_updated_at: new Date().toISOString() })
        .eq('id', l.id)
      updated++
    }
    return NextResponse.json({ ok: true, updated, rate })
  }

  const role = String(b.role ?? '')
  const itemId = Number(b.item_id)
  if (!role || !Number.isFinite(itemId)) return NextResponse.json({ error: 'Нужны role и item_id' }, { status: 400 })

  const { data: it } = await svc.from('supplier_price_items')
    .select('id, name, article, price_usd, price_rub, currency, unit').eq('id', itemId).maybeSingle()
  if (!it) return NextResponse.json({ error: 'Позиция прайса не найдена' }, { status: 404 })

  const { error } = await svc.from('mirror_lighting_components').insert({
    component_type: role,
    name: it.name,
    short_name: it.article || null,
    unit: it.unit || 'шт',
    cost_price: rub(it),
    active: true,
    sort_order: 0,
    voltage: b.voltage ?? null,
    power_per_meter: b.power_per_meter ?? null,
    max_power: b.max_power ?? null,
    pack_length_m: b.pack_length_m ?? null,
    source_supplier: 'eleganz',
    source_item_id: Number(it.id),
    price_updated_at: new Date().toISOString(),
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, rate })
}
