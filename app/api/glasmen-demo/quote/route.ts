import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'
import { computeQuoteItem, type QuoteItemInput } from '@/lib/b2b/computeQuote'
import { effectiveItemTotal, resolveMinLinePrice, type B2BOrderItem } from '@/lib/b2bCalculator'
import { isSurchargeServiceId } from '@/lib/surcharges'
import {
  PRESETS, PRICE_MODEL_IDS, PARAMS_USED, priceLadder, sanitizeParams, itemComponents,
  type BreakdownLine, type PriceModelId, type PriceModelParams, type PriceLadderRow,
} from '@/lib/glasmen/priceModel'
import { MAX_HOLE_D_MM } from '@/lib/glasmen/types'
import { loadDemoRefs, temperableOf } from '../_refs'

export const dynamic = 'force-dynamic'

// Демо GLASMEN «SendCutSend для стекла»: цена детали по количеству в пяти моделях.
// Только владелец. Цену считает код: v1 и v(q) — единый движок computeQuoteItem
// (applyMinPrice:false), пол — resolveMinLinePrice, модели — lib/glasmen/priceModel.ts.
// Общий прайс: без индивидуальных цен и скидки клиента (скидка — параметр демо).
// Наружу — только цена клиенту: ни себестоимости, ни маржи, ни НДС к вычету.

const DEFAULT_QTYS = [1, 2, 5, 10, 25, 50]
const SIZE = { min: 10, max: 6000 }
const QTY = { min: 1, max: 10000, count: 20 }
const GROUP_LINES_MAX = 1000                    // строк одного материала в корзине демо

type Body = {
  materialId?: unknown; width?: unknown; height?: unknown; shape?: unknown
  holes?: unknown; cutouts?: unknown; hasTempering?: unknown; hasFacet?: unknown; facetTypeMm?: unknown
  quantities?: unknown; discountPct?: unknown; models?: unknown; params?: unknown
  asWholeOrder?: unknown; groupLines?: unknown; groupIndex?: unknown
}

const bad = (error: string) => NextResponse.json({ error }, { status: 400 })
const isInt = (x: number) => Number.isFinite(x) && Math.round(x) === x

export async function POST(req: NextRequest) {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard

  const body = (await req.json().catch(() => null)) as Body | null
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('Тело запроса — JSON-объект')

  const materialId = Number(body.materialId)
  if (!isInt(materialId)) return bad('materialId — целое число')
  const width = Number(body.width)
  const height = Number(body.height)
  for (const [k, v] of [['width', width], ['height', height]] as const) {
    if (!Number.isFinite(v) || v < SIZE.min || v > SIZE.max) return bad(`${k} — от ${SIZE.min} до ${SIZE.max} мм`)
  }
  if (body.shape !== undefined && body.shape !== 'rect' && body.shape !== 'curved') return bad('shape — rect или curved')
  const shape: 'rect' | 'curved' = body.shape === 'curved' ? 'curved' : 'rect'

  const holes: { d: number; n: number }[] = []
  if (body.holes !== undefined) {
    if (!Array.isArray(body.holes) || body.holes.length > 50) return bad('holes — массив до 50 групп {d, n}')
    for (const h of body.holes) {
      const d = Number((h as { d?: unknown })?.d)
      const n = Number((h as { n?: unknown })?.n)
      // Круг крупнее MAX_HOLE_D_MM — круглый вырез (lib/glasmen/toQuoteInput.ts), его шлют в cutouts.
      if (!Number.isFinite(d) || d < 1 || d > MAX_HOLE_D_MM || !isInt(n) || n < 1 || n > 500) return bad(`holes: d — 1…${MAX_HOLE_D_MM} мм (крупнее — вырез), n — целое 1…500`)
      holes.push({ d, n })
    }
  }
  const cutouts = body.cutouts === undefined ? 0 : Number(body.cutouts)
  if (!isInt(cutouts) || cutouts < 0 || cutouts > 100) return bad('cutouts — целое 0…100')
  for (const k of ['hasTempering', 'hasFacet', 'asWholeOrder'] as const) {
    if (body[k] !== undefined && typeof body[k] !== 'boolean') return bad(`${k} — true или false`)
  }
  const hasTempering = body.hasTempering === true
  const hasFacet = body.hasFacet === true
  const asWholeOrder = body.asWholeOrder === true

  let quantities = DEFAULT_QTYS
  if (body.quantities !== undefined) {
    if (!Array.isArray(body.quantities) || body.quantities.length === 0 || body.quantities.length > QTY.count) return bad(`quantities — от 1 до ${QTY.count} значений`)
    const qs = body.quantities.map(Number)
    if (qs.some(q => !isInt(q) || q < QTY.min || q > QTY.max)) return bad(`quantities — целые ${QTY.min}…${QTY.max}`)
    quantities = [...new Set(qs)].sort((a, b) => a - b)
  }
  const discountPct = body.discountPct === undefined ? 0 : Number(body.discountPct)
  if (!Number.isFinite(discountPct) || discountPct < 0 || discountPct > 30) return bad('discountPct — от 0 до 30')
  const groupLines = body.groupLines === undefined ? 1 : Number(body.groupLines)
  if (!isInt(groupLines) || groupLines < 1 || groupLines > GROUP_LINES_MAX) return bad(`groupLines — целое 1…${GROUP_LINES_MAX}`)
  const groupIndex = body.groupIndex === undefined ? 0 : Number(body.groupIndex)
  if (!isInt(groupIndex) || groupIndex < 0 || groupIndex >= groupLines) return bad('groupIndex — целое 0…groupLines−1')

  let models: PriceModelId[] = PRICE_MODEL_IDS
  if (body.models !== undefined) {
    if (!Array.isArray(body.models) || body.models.length === 0) return bad('models — непустой массив')
    const unknown = body.models.filter(m => !PRICE_MODEL_IDS.includes(m as PriceModelId))
    if (unknown.length) return bad(`Неизвестные модели: ${unknown.map(String).join(', ')}`)
    models = PRICE_MODEL_IDS.filter(id => (body.models as unknown[]).includes(id))
  }
  if (body.params !== undefined && (body.params === null || typeof body.params !== 'object' || Array.isArray(body.params))) {
    return bad('params — объект { [модель]: параметры }')
  }
  const rawParams = (body.params ?? {}) as Record<string, unknown>

  const refs = await loadDemoRefs(createServiceClient())
  if ('error' in refs) return NextResponse.json({ error: refs.error }, { status: 500 })
  const warnings = [...refs.warnings]

  const material = refs.materials.find(m => m.id === materialId)
  if (!material) return bad('Материал не найден среди активных с ценой')
  const temperable = temperableOf(material, refs.rates)
  if (hasTempering && temperable === false) return bad(`${material.name} (${material.category}) не закаляется`)
  if (hasTempering && temperable === null) warnings.push(`Нет ставки закалки для ${material.thickness} мм в b2b_rates — закаляемость не подтверждена`)

  let facetTypeMm: number | null = null
  if (hasFacet) {
    facetTypeMm = Number(body.facetTypeMm ?? 10)
    const known = refs.facetPrices.map(f => f.type_mm)
    // Без строки справочника движок посчитал бы фацет нулём — это не цена, а пропуск.
    if (!known.includes(facetTypeMm)) return bad(`Фацет ${body.facetTypeMm} мм не в справочнике; есть: ${known.join(', ') || 'нет активных'}`)
  }

  const ref = { facetPrices: refs.facetPrices, surchargeRules: refs.surchargeRules, rates: refs.rates }
  const base: Omit<QuoteItemInput, 'quantity'> = {
    material, width, height, shape, hasTempering, hasFacet, facetTypeMm,
    holes, hasHoles: holes.length > 0, cutouts, hasCutouts: cutouts > 0,
  }

  const piece = computeQuoteItem({ ...base, quantity: 1, applyMinPrice: false }, ref)
  const v1 = piece.saleIncVat
  const fp = resolveMinLinePrice(material.category, width, height, hasTempering, refs.rates.minLine)?.minPricePerPiece ?? 0
  const lineValues: Record<number, number> = {}
  const lineComponents: Record<number, BreakdownLine[]> = {}
  for (const q of quantities) {
    const it = computeQuoteItem({ ...base, quantity: q, applyMinPrice: false }, ref)
    lineValues[q] = it.saleIncVat
    lineComponents[q] = itemComponents(it)
  }
  const input = { v1, floorPerPiece: fp, discountPct, quantities, lineValues, lineComponents, groupLines, groupIndex, asWholeOrder }

  // Сверка: модель «Сейчас» обязана совпасть с движком (пол и скидка как в КП).
  const currentRows = priceLadder(input, 'current')
  for (const row of currentRows) {
    const it = computeQuoteItem({ ...base, quantity: row.qty }, ref)
    const engine = effectiveItemTotal({ ...it, localId: 'demo' } as B2BOrderItem, discountPct)
    if (engine !== row.lineTotal) warnings.push(`«Сейчас» ${row.qty} шт.: модель ${row.lineTotal} ₽, движок ${engine} ₽ — расхождение ${row.lineTotal - engine} ₽`)
  }

  const out: Record<string, { title: string; description: string; source: string; params: PriceModelParams; paramsUsed: (keyof PriceModelParams)[]; rows: PriceLadderRow[] }> = {}
  for (const id of models) {
    const { params, warnings: pw } = sanitizeParams(id, rawParams[id])
    warnings.push(...pw)
    out[id] = {
      title: PRESETS[id].title,
      description: PRESETS[id].description,
      source: PRESETS[id].source,
      params,
      paramsUsed: PARAMS_USED[id],
      rows: id === 'current' ? currentRows : priceLadder(input, id, params),
    }
  }
  for (const k of Object.keys(rawParams)) if (!models.includes(k as PriceModelId)) warnings.push(`params.${k}: такой модели нет в запросе — пропущено`)

  return NextResponse.json({
    material: { id: material.id, name: material.name, thickness: material.thickness, category: material.category, pricePerM2: Math.round(material.sale_price ?? 0), temperable },
    areaPieceM2: piece.areaPiece,
    weightPieceKg: piece.totalWeight,
    v1,
    floorPerPiece: fp,
    discountPct,
    surcharges: piece.services.filter(s => isSurchargeServiceId(s.id)).map(s => ({ name: s.name, pct: s.value })),
    models: out,
    warnings,
  })
}
