import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { prepPricedMaterials } from '@/lib/b2bMaterialPricing'
import { calcItem, effectiveItemTotal, type B2BOrderItem } from '@/lib/b2bCalculator'
import { MGLASS_CLIENT_IDS } from '@/lib/b2bScope'
import { calcMirrorQuote, type MirrorComponent, type MirrorQuoteInput } from '@/lib/mirror/mirrorQuote'
import type { B2BMaterial } from '@/lib/types'

export const dynamic = 'force-dynamic'

// Цена зеркала для вкладки «Расчёт» (маршрут З5). Композиция, как у душевых:
//  • само зеркало — B2B-калькулятор («почём для M-Glass»: цена по прайсу минус
//    скидка M GLASS), тот же путь, что стекло душевой;
//  • подсветка и рамка — движок lib/mirror/mirrorQuote по справочникам.
// Себестоимость считается ЗДЕСЬ и наружу уходит спецификацией. В браузер
// закупочные цены не отдаём — этим болен старый /calculator/mirror.

const DEFAULT_MIRROR = 'Серебро'   // обычное зеркало; подставляется, если тип не выбран

export async function POST(req: NextRequest) {
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return NextResponse.json({ full: false, error: 'unauthorized' }, { status: 401 })

  const b = await req.json().catch(() => null) as (Partial<MirrorQuoteInput> & {
    thickness?: number; materialName?: string; quantity?: number
  }) | null
  if (!b?.width || !b?.height) return NextResponse.json({ full: false, error: 'нужны размеры' }, { status: 400 })

  const thickness = Number(b.thickness) || 4
  const qty = Math.max(1, Number(b.quantity) || 1)
  const svc = createServiceClient()

  const [{ data: mats }, { data: matrix }, { data: mgClient }, { data: comps }, { data: rates }] = await Promise.all([
    svc.from('b2b_materials').select('*').eq('active', true),
    svc.from('glass_price_matrix').select('name,category,price_type,t4,t5,t6,t8,t10,waste_pct'),
    svc.from('b2b_clients').select('id,discount_percent').in('id', [...MGLASS_CLIENT_IDS]).maybeSingle(),
    svc.from('mirror_lighting_components')
      .select('id, component_type, name, voltage, power_per_meter, max_power, cost_price, unit, pack_length_m')
      .eq('active', true),
    svc.from('mirror_frame_rates').select('key, value'),
  ])

  // Зеркало: ищем строго среди зеркал — под одним именем в справочнике живут
  // и стекло, и зеркало, и на 4/6 мм зеркальная строка стоит вчетверо дороже.
  const priced = prepPricedMaterials((mats ?? []) as B2BMaterial[], (matrix ?? []) as Array<Record<string, unknown>>)
  const mirrors = priced.filter(m => m.category === 'зеркало')
  const wanted = b.materialName?.trim() || DEFAULT_MIRROR
  const mat =
    mirrors.find(m => m.name === wanted && Math.round(m.thickness) === thickness) ??
    mirrors.find(m => Math.round(m.thickness) === thickness) ??
    null

  let glassCost = 0
  const glassMissing: { role: string; label: string; reason: 'нет цены' }[] = []
  if (mat) {
    const mgDiscount = Number(mgClient?.discount_percent) || 0
    const item = calcItem(mat, Math.round(b.width), Math.round(b.height), qty, mat.waste_percent, false)
    glassCost = effectiveItemTotal(item as B2BOrderItem, mgDiscount)
  } else {
    glassMissing.push({ role: 'mirror', label: `зеркало ${thickness} мм: нет в справочнике`, reason: 'нет цены' })
  }

  // П-образный профиль садится только на 6 мм — это конструктив, а не пожелание.
  const frameConflict = b.frame === 'ushape' && thickness !== 6

  const frameRates: Record<string, number> = {}
  for (const r of (rates ?? []) as { key: string; value: number }[]) frameRates[r.key] = Number(r.value) || 0

  const quote = calcMirrorQuote({
    width: b.width, height: b.height,
    shape: b.shape ?? 'rect',
    lighting: !!b.lighting,
    sides: b.sides ?? { top: true, bottom: false, left: false, right: false },
    voltage: b.voltage === 24 ? 24 : 12,
    control: b.control ?? 'none',
    frame: b.frame ?? 'none',
    glassCost,
  }, (comps ?? []) as MirrorComponent[], frameRates)

  const missing = [...quote.missing, ...glassMissing]
  if (frameConflict) missing.push({ role: 'frame_ushape', label: 'П-профиль требует зеркало 6 мм', reason: 'нет позиции' })

  return NextResponse.json({
    full: true,
    price: {
      ...quote,
      missing,
      complete: missing.length === 0,
      mirrorSource: mat ? `${mat.name}, ${Math.round(mat.thickness)} мм` : null,
      quantity: qty,
    },
  }, { headers: { 'Cache-Control': 'no-store' } })
}
