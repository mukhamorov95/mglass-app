import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { getModel, M_MODELS } from '@/lib/configurator/arrangement'
import { computeKitQuantities, computeKitPrice, type RoleId } from '@/lib/configurator/kit'
import { buildWithVariant } from '@/lib/configurator/quoteContract'
import type { MVariant } from '@/components/configurator/scene/assembly'
import { resolveTierData } from '@/lib/configurator/priceVersion'
import { prepPricedMaterials } from '@/lib/b2bMaterialPricing'
import { calcItem, effectiveItemTotal, type B2BOrderItem } from '@/lib/b2bCalculator'
import { MGLASS_CLIENT_IDS } from '@/lib/b2bScope'
import type { B2BMaterial } from '@/lib/types'

export const dynamic = 'force-dynamic'

// Расчёт изделия для вкладки «Расчёт» кабинета менеджера. Композирует ДВА движка,
// ни один не редактирует:
//  • фурнитура и количества — конфигуратор (computeKitPrice по комплекту модели);
//  • деньги за стекло — B2B-калькулятор пер-панельно (calcItem по габаритам панелей,
//    закалка, отход, кромка), и уходят в computeKitPrice как glassCostOverride.
// «Почём для M-Glass»: стекло делает производство, M-Glass покупает его по B2B-цене
// со скидкой M GLASS — поэтому берём effectiveItemTotal(панель, скидка M GLASS), ровно
// как в «Расчёте B2B». Фурнитуру M-Glass берёт у внешних поставщиков — там закупка (BOM).
// glassM2 из геометрии не трогаем: она нужна секциям/монтажу.

const DEFAULT_GLASS = 'Прозрачное М1'   // 8 мм, дефолт душевых (id 4); не константа — из glassType

export async function POST(req: NextRequest) {
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return NextResponse.json({ full: false, error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null) as {
    model?: string; dims?: { width: number; height: number; width2?: number; doorWidth?: number }
    thickness?: number; finishId?: string; glassType?: string; withDelivery?: boolean; floors?: number
    zoneId?: string; km?: number; installFactors?: string[]; choice?: Record<string, string>; qtyChoice?: Record<string, number>
    variant?: MVariant
  } | null
  if (!body?.model || !body.dims || !M_MODELS.some(m => m.code === body.model)) {
    return NextResponse.json({ full: false, error: 'model + dims обязательны' }, { status: 400 })
  }
  const thickness = body.thickness ?? 8
  const model = getModel(body.model)
  const svc = createServiceClient()

  // ── Стекло: цена по B2B-калькулятору, пер-панельно ──────────────────────────
  const [{ data: mats }, { data: matrix }, { data: mgClient }] = await Promise.all([
    svc.from('b2b_materials').select('*').eq('active', true),
    svc.from('glass_price_matrix').select('name,category,price_type,t4,t5,t6,t8,t10,waste_pct'),
    svc.from('b2b_clients').select('id,discount_percent').in('id', [...MGLASS_CLIENT_IDS]).maybeSingle(),
  ])
  const priced = prepPricedMaterials((mats ?? []) as B2BMaterial[], (matrix ?? []) as Array<Record<string, unknown>>)
  const glassName = body.glassType?.trim() || DEFAULT_GLASS
  // Зеркало исключаем и при поиске по имени: «Тонированное (бронза/графит)» заведено
  // дважды — как стекло и как зеркало, и на 4/6 мм зеркальная строка перебивала бы
  // стекло по цене вчетверо. В душевой зеркала не бывает.
  const isGlass = (m: B2BMaterial) => m.category !== 'зеркало'
  const glassMat =
    priced.find(m => m.name === glassName && Math.round(m.thickness) === thickness && isGlass(m)) ??
    priced.find(m => m.name === DEFAULT_GLASS && Math.round(m.thickness) === thickness && isGlass(m)) ??
    priced.find(m => Math.round(m.thickness) === thickness && isGlass(m))
  // Скидка M GLASS (производство → M-Glass): та же, что в «Расчёте B2B».
  const mgDiscount = Number(mgClient?.discount_percent) || 0

  // Панели стекла из геометрии — те же размеры, что уходят в раскрой и на сайт.
  // Вариант приходит с экрана: у М1 он говорит, что введена ширина САМОЙ панели,
  // и какое крепление трубы. Без него геометрия для цены расходилась бы с 3D.
  const assembly = buildWithVariant(model, body.dims, thickness, body.variant)
  const glassMissing: string[] = []
  let glassCost = 0
  // Спецификация стекла: по одной строке на панель — размер, площадь, ₽/м² по прайсу,
  // сумма и скидка M GLASS. Менеджеру нужно видеть, из чего сложилась цифра.
  const glassLines: Array<{
    label: string; w: number; h: number; areaM2: number; pricePerM2: number
    listTotal: number; total: number; minPriceApplied: boolean
  }> = []
  if (glassMat) {
    assembly.glass.forEach((g, i) => {
      const w = Math.round(g.size[0] * 1000)
      const h = Math.round(g.size[1] * 1000)
      if (w <= 0 || h <= 0) return
      // Душевое стекло — всегда закалённое (hasTempering=true), иначе занижение.
      const item = calcItem(glassMat, w, h, 1, glassMat.waste_percent, true)
      const total = effectiveItemTotal(item as B2BOrderItem, mgDiscount)
      glassCost += total
      glassLines.push({
        label: `Панель ${i + 1}`,
        w, h,
        areaM2: item.totalAreaNet,
        pricePerM2: item.pricePerM2,
        listTotal: item.saleIncVat,
        total,
        minPriceApplied: !!item.minPriceApplied,
      })
    })
  } else {
    glassMissing.push('стекло: материал не найден в справочнике')
  }

  // ── Фурнитура + количества + цена — движок конфигуратора ─────────────────────
  const { data: { library, rates, kits }, finance } = await resolveTierData('budget')
  const q = computeKitQuantities(assembly, thickness, model, rates.capMargin)
  const price = computeKitPrice(q, library, kits[body.model] ?? { slots: [] }, rates, finance, {
    finishId: body.finishId,
    withDelivery: body.withDelivery,
    floors: body.floors,
    zoneId: body.zoneId,
    km: body.km,
    installFactors: body.installFactors,
    choice: body.choice as Partial<Record<RoleId, string>> | undefined,
    qtyChoice: body.qtyChoice as Partial<Record<RoleId, number>> | undefined,
    glassCostOverride: glassCost,   // деньги за стекло — из B2B, а не флэт-ставка
  })

  // Если стекло не посчиталось — сообщаем как пробел, не занижаем молча.
  const missing = [...price.missing, ...glassMissing.map(label => ({ role: 'glass' as RoleId, label, reason: 'нет цены' as const }))]
  return NextResponse.json({
    full: true,
    price: {
      ...price, missing, complete: price.complete && glassMissing.length === 0,
      glassSource: glassMat ? glassMat.name : null,
      glassThickness: glassMat ? glassMat.thickness : thickness,
      glassDiscountPct: mgDiscount,
      glassLines,
    },
  }, { headers: { 'Cache-Control': 'no-store' } })
}
