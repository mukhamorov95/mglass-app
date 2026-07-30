import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { prepPricedMaterials } from '@/lib/b2bMaterialPricing'
import { calcItem, calcTotals, type FacetPrice, type B2BOrderItem } from '@/lib/b2bCalculator'
import type { B2BMaterial } from '@/lib/types'

// Партнёрский просчёт. КРИТИЧНО: считает СЕРВЕР нашим движком (calcItem) — тот же,
// что у менеджера. Наружу отдаём ТОЛЬКО цену партнёра, никогда cost/margin.
// Клиентским цифрам не доверяем: берём материал/прайс с сервера по materialId.
// save=false → превью (не пишем в БД); save=true → сохраняем как b2b_orders quote.

type ItemSpec = {
  materialId: number
  width: number
  height: number
  quantity: number
  hasTempering?: boolean
  hasFacet?: boolean
  facetTypeMm?: number | null
  hasHoles?: boolean
  shape?: 'rect' | 'curved'
}

export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: client } = await svc.from('b2b_clients').select('id,name,discount_percent').eq('user_id', user.id).maybeSingle()
  if (!client) return NextResponse.json({ error: 'Аккаунт не привязан' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const specs = Array.isArray(body?.items) ? (body.items as ItemSpec[]) : []
  const save = body?.save === true
  const comment = typeof body?.comment === 'string' ? body.comment.slice(0, 500) : ''
  if (specs.length === 0) return NextResponse.json({ error: 'Нет позиций' }, { status: 400 })
  if (specs.length > 200) return NextResponse.json({ error: 'Слишком много позиций' }, { status: 400 })

  const [{ data: mats }, { data: matrix }, { data: facets }] = await Promise.all([
    svc.from('b2b_materials').select('*').eq('active', true),
    svc.from('glass_price_matrix').select('name,category,price_type,t4,t5,t6,t8,t10,waste_pct'),
    svc.from('facet_prices').select('*').eq('active', true),
  ])
  const priced = prepPricedMaterials((mats ?? []) as B2BMaterial[], (matrix ?? []) as Array<Record<string, unknown>>)
  const byId = new Map(priced.map(m => [m.id, m]))
  const facetPrices = (facets ?? []) as FacetPrice[]
  const discount = Number(client.discount_percent) || 0

  const items: B2BOrderItem[] = []
  for (const s of specs) {
    const mat = byId.get(Number(s.materialId))
    const w = Number(s.width) || 0
    const h = Number(s.height) || 0
    const q = Number(s.quantity) || 0
    if (!mat || w <= 0 || h <= 0 || q <= 0) return NextResponse.json({ error: 'Некорректная позиция' }, { status: 400 })
    const calc = calcItem(
      mat, w, h, q, mat.waste_percent, !!s.hasTempering, [],
      !!s.hasFacet, s.hasFacet ? (Number(s.facetTypeMm) || 10) : null, facetPrices,
      false, 2, null, [], true,
    )
    items.push({ ...calc, localId: `p${items.length}`, hasHoles: !!s.hasHoles, shape: s.shape === 'curved' ? 'curved' : 'rect' })
  }

  const totals = calcTotals(items, discount)

  // Партнёру — только безопасное: по позициям цена, и итог (его цена).
  const safeItems = items.map(it => ({
    material: it.materialName,
    thickness: it.thickness,
    width: it.width, height: it.height, quantity: it.quantity,
    price: it.saleIncVat,
  }))
  const partnerTotal = totals.totalAfterDiscount

  if (!save) {
    return NextResponse.json({ ok: true, items: safeItems, total: partnerTotal, discountPercent: discount })
  }

  // Сохранение как просчёт (виден нам и партнёру). Полные поля (с cost) — для нас;
  // партнёр их не получает (его API отдаёт только цену).
  const marginPct = totals.totalSaleExVat > 0 ? Math.round((1 - totals.totalCostExVat / totals.totalSaleExVat) * 100) : 0
  const notes = JSON.stringify({
    status: 'quote', source: 'partner', created_by_partner: true,
    partner_comment: comment || undefined,
    quote_date: new Date().toISOString(),
  })
  const { data: inserted, error } = await svc.from('b2b_orders').insert({
    client_id: client.id,
    client_name: client.name,
    organization_id: 1,
    discount_percent: discount,
    margin_percent: marginPct,
    items,
    total_area: totals.totalAreaNet,
    total_weight: totals.totalWeight,
    total_cost_net: totals.totalCostExVat,
    total_cost_vat: totals.totalInputVat,
    total_sale_inc_vat: totals.totalSaleIncVat,
    total_after_discount: totals.totalAfterDiscount,
    notes,
    source: 'partner',
    created_by: user.id,
    created_by_name: client.name,
    updated_at: new Date().toISOString(),
  }).select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, quoteId: (inserted as { id: number }).id, items: safeItems, total: partnerTotal, discountPercent: discount })
}
