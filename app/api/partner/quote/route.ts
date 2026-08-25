import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { applyClientPrices, loadClientPrices } from '@/lib/b2b/clientPrices'
import { prepPricedMaterials } from '@/lib/b2bMaterialPricing'
import { computeQuoteItem, computeQuoteTotals } from '@/lib/b2b/computeQuote'
import type { FacetPrice, B2BOrderItem } from '@/lib/b2bCalculator'
import type { SurchargeRule } from '@/lib/surcharges'
import type { B2BMaterial, B2BService } from '@/lib/types'
import { resolvePartnerClient } from '@/lib/partnerClient'

// Партнёрский просчёт. КРИТИЧНО: считает СЕРВЕР через ЕДИНЫЙ движок computeQuoteItem —
// тот же, что у менеджера (/calculator/b2b). Включает авто-надбавки за габариты/
// сложность (b2b_surcharge_rules), фацет, закалку, триплекс, мин.цену — цена
// не может разойтись с менеджерской. Наружу отдаём ТОЛЬКО цену партнёра, никогда
// cost/margin. Клиентским цифрам не доверяем: материал/прайс берём с сервера по materialId.
// save=false → превью (не пишем в БД); save=true → сохраняем как b2b_orders quote.

type ItemSpec = {
  materialId: number
  width: number
  height: number
  quantity: number
  hasTempering?: boolean
  hasFacet?: boolean
  facetTypeMm?: number | null
  hasHoles?: boolean               // сверловка — пока только флаг (на цену не влияет), как у менеджера
  shape?: 'rect' | 'curved'
  hasTriplex?: boolean
  triplexLayers?: 2 | 3
  triplexMat2Id?: number | null
  triplexMat3Id?: number | null
  applyMinPrice?: boolean
  comment?: string
}

export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const client = await resolvePartnerClient<{ id: number; name: string; discount_percent: number | null }>(svc, user.id, 'id,name,discount_percent')
  if (!client) return NextResponse.json({ error: 'Аккаунт не привязан' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const specs = Array.isArray(body?.items) ? (body.items as ItemSpec[]) : []
  const save = body?.save === true
  const editId = Number(body?.editId) || null   // редактирование существующего просчёта
  const comment = typeof body?.comment === 'string' ? body.comment.slice(0, 500) : ''
  if (specs.length === 0) return NextResponse.json({ error: 'Нет позиций' }, { status: 400 })
  if (specs.length > 200) return NextResponse.json({ error: 'Слишком много позиций' }, { status: 400 })

  // Все справочники — те же таблицы и активные строки, что и у менеджера.
  const [{ data: mats }, { data: matrix }, { data: facets }, { data: surcharges }, { data: services }] = await Promise.all([
    svc.from('b2b_materials').select('*').eq('active', true),
    svc.from('glass_price_matrix').select('name,category,price_type,t4,t5,t6,t8,t10,waste_pct'),
    svc.from('facet_prices').select('*').eq('active', true),
    svc.from('b2b_surcharge_rules').select('*').eq('active', true).order('sort_order'),
    svc.from('b2b_services').select('*').eq('active', true),
  ])
  // А12: индивидуальный прайс клиента поверх общего — кабинет партнёра обязан
  // считать по тем же ценам, что менеджер, иначе цифры разойдутся.
  const clientPrices = await loadClientPrices(svc, client.id)
  const priced = applyClientPrices(
    prepPricedMaterials((mats ?? []) as B2BMaterial[], (matrix ?? []) as Array<Record<string, unknown>>),
    clientPrices,
  )
  const byId = new Map(priced.map(m => [m.id, m]))
  const facetPrices = (facets ?? []) as FacetPrice[]
  const surchargeRules = (surcharges ?? []) as SurchargeRule[]
  const discount = Number(client.discount_percent) || 0

  // Цена триплексации — из справочника услуг (per_m2 «Триплекс»), как у менеджера.
  const triplexSvc = ((services ?? []) as B2BService[]).find(s => s.type === 'per_m2' && /триплекс/i.test(s.name))
  const triplexPrice = triplexSvc ? { salePerM2: Number(triplexSvc.value) || 0, costPerM2: Number(triplexSvc.cost_price) || 0 } : null

  const items: B2BOrderItem[] = []
  for (const s of specs) {
    const mat = byId.get(Number(s.materialId))
    const w = Number(s.width) || 0
    const h = Number(s.height) || 0
    const q = Number(s.quantity) || 0
    if (!mat || w <= 0 || h <= 0 || q <= 0) return NextResponse.json({ error: 'Некорректная позиция' }, { status: 400 })

    const triplexExtraGlasses = s.hasTriplex
      ? [byId.get(Number(s.triplexMat2Id)) ?? mat, ...(s.triplexLayers === 3 ? [byId.get(Number(s.triplexMat3Id)) ?? mat] : [])]
      : []

    const calc = computeQuoteItem(
      {
        material: mat,
        width: w, height: h, quantity: q,
        hasTempering: !!s.hasTempering,
        hasFacet: !!s.hasFacet,
        facetTypeMm: s.hasFacet ? (Number(s.facetTypeMm) || 10) : null,
        hasHoles: !!s.hasHoles,
        shape: s.shape === 'curved' ? 'curved' : 'rect',
        hasTriplex: !!s.hasTriplex,
        triplexLayers: s.triplexLayers === 3 ? 3 : 2,
        triplexPrice,
        triplexExtraGlasses,
        applyMinPrice: s.applyMinPrice !== false,
        comment: typeof s.comment === 'string' ? s.comment.slice(0, 120) : undefined,
        // resolvedServices: [] — доп-услуги в кабинете пилота не выбираются; надбавки за габариты применяются автоматически
      },
      { facetPrices, surchargeRules },
    )
    items.push({ ...calc, localId: `p${items.length}` })
  }

  const totals = computeQuoteTotals(items, discount)

  // Наружу — только безопасное: по позициям цена клиента (с НДС), и итог со скидкой.
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

  // Редактирование: обновляем существующий просчёт партнёра (строго свой, не запущенный).
  if (editId) {
    const { data: ex } = await svc.from('b2b_orders').select('id,client_id,launched_at,notes').eq('id', editId).maybeSingle()
    const exr = ex as { client_id: number | null; launched_at: string | null; notes: string | null } | null
    if (!exr || exr.client_id !== client.id) return NextResponse.json({ error: 'Просчёт не найден' }, { status: 404 })
    if (exr.launched_at) return NextResponse.json({ error: 'Заказ уже в работе — редактирование недоступно' }, { status: 400 })
    let en: Record<string, unknown> = {}
    try { en = exr.notes ? JSON.parse(exr.notes) : {} } catch {}
    if (en.status && en.status !== 'quote') return NextResponse.json({ error: 'Просчёт уже отправлен — редактирование недоступно' }, { status: 400 })
    en.status = 'quote'; en.source = 'partner'
    en.partner_comment = comment || undefined
    en.updated_by_partner_at = new Date().toISOString()
    const { error: upErr } = await svc.from('b2b_orders').update({
      discount_percent: discount, margin_percent: marginPct, items,
      total_area: totals.totalAreaNet, total_weight: totals.totalWeight,
      total_cost_net: totals.totalCostExVat, total_cost_vat: totals.totalInputVat,
      total_sale_inc_vat: totals.totalSaleIncVat, total_after_discount: totals.totalAfterDiscount,
      notes: JSON.stringify(en), updated_at: new Date().toISOString(),
    }).eq('id', editId)
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
    return NextResponse.json({ ok: true, quoteId: editId, items: safeItems, total: partnerTotal, discountPercent: discount })
  }

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
