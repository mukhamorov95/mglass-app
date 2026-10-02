import type { SupabaseClient } from '@supabase/supabase-js'
import { getModel } from '@/lib/configurator/arrangement'
import { canSplice, computeKitQuantities, computeKitPrice, piecesForRole, type RoleId } from '@/lib/configurator/kit'
import { buildWithVariant } from '@/lib/configurator/quoteContract'
import type { MVariant } from '@/components/configurator/scene/assembly'
import { resolveTierData } from '@/lib/configurator/priceVersion'
import { prepPricedMaterials } from '@/lib/b2bMaterialPricing'
import { calcItem, effectiveItemTotal, type B2BOrderItem } from '@/lib/b2bCalculator'
import { loadB2BRates } from '@/lib/b2b/rates'
import { MGLASS_CLIENT_IDS } from '@/lib/b2bScope'
import type { B2BMaterial } from '@/lib/types'
import { buildStops } from '@/lib/calc/buildStops'
import { loadOrderFundSettings } from '@/lib/pricing/orderFundsStore'
import { targetPrices } from '@/lib/pricing/orderFunds'

// Расчёт изделия для вкладки «Расчёт» кабинета менеджера и стандартной линейки CFO.
// Композирует ДВА движка, ни один не редактирует:
//  • фурнитура и количества — конфигуратор (computeKitPrice по комплекту модели);
//  • деньги за стекло — B2B-калькулятор пер-панельно (calcItem по габаритам панелей,
//    закалка, отход, кромка), и уходят в computeKitPrice как glassCostOverride.
// «Почём для M-Glass»: стекло делает производство, M-Glass покупает его по B2B-цене
// со скидкой M GLASS — поэтому берём effectiveItemTotal(панель, скидка M GLASS), ровно
// как в «Расчёте B2B». Фурнитуру M-Glass берёт у внешних поставщиков — там закупка (BOM).
// glassM2 из геометрии не трогаем: она нужна секциям/монтажу.
// Клиент — service role: вызывающий обязан проверить доступ до вызова.

const DEFAULT_GLASS = 'Прозрачное М1'   // 8 мм, дефолт душевых (id 4); не константа — из glassType

export type BuildRequest = {
  model: string
  dims: { width: number; height: number; width2?: number; doorWidth?: number }
  thickness?: number; finishId?: string; glassType?: string; withDelivery?: boolean; floors?: number
  zoneId?: string; km?: number; installFactors?: string[]; choice?: Record<string, string>; qtyChoice?: Record<string, number>
  variant?: MVariant
  // Расчёт по чертежу (Ч1): размеры панелей с чертежа — по индексу как в геометрии;
  // артикулы, как подписаны на чертеже, по роли. Цену это не меняет, кроме стекла по
  // размерам чертежа, — расхождения уходят в stops.
  panels?: Array<{ w: number; h: number } | null>
  drawn?: Record<string, string>
  // Ш1: заказ идёт через известного партнёра (его доля — в знаменателе цены для цели) и сколько
  // в заказе изделий (доставка одна на заказ, делится поровну).
  partner?: boolean
  orderItems?: number
}

export async function priceBuild(svc: SupabaseClient, body: BuildRequest) {
  const thickness = body.thickness ?? 8
  const model = getModel(body.model)

  // ── Стекло: цена по B2B-калькулятору, пер-панельно ──────────────────────────
  const [{ data: mats }, { data: matrix }, { data: mgClient }, loadedRates] = await Promise.all([
    svc.from('b2b_materials').select('*').eq('active', true),
    svc.from('glass_price_matrix').select('name,category,price_type,t4,t5,t6,t8,t10,waste_pct'),
    svc.from('b2b_clients').select('id,discount_percent').in('id', [...MGLASS_CLIENT_IDS]).maybeSingle(),
    loadB2BRates(svc),
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
  // Запрошенного стекла нет в справочнике — считаем по другому, но говорим об этом.
  const glassSubstituted = glassMat && glassMat.name !== glassName ? `${glassName} → ${glassMat.name}` : null
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
    index: number; label: string; w: number; h: number; areaM2: number; pricePerM2: number
    listTotal: number; total: number; minPriceApplied: boolean
  }> = []
  if (glassMat) {
    assembly.glass.forEach((g, i) => {
      const fromDrawing = body.panels?.[i]
      const w = Math.round(fromDrawing?.w || g.size[0] * 1000)
      const h = Math.round(fromDrawing?.h || g.size[1] * 1000)
      if (w <= 0 || h <= 0) return
      // Душевое стекло — всегда закалённое (hasTempering=true), иначе занижение.
      const item = calcItem(glassMat, w, h, 1, glassMat.waste_percent, true, [], false, null, [], false, 2, null, [], true, loadedRates.rates)
      const total = effectiveItemTotal(item as B2BOrderItem, mgDiscount)
      glassCost += total
      glassLines.push({
        index: i, label: `Панель ${i + 1}`,
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
  for (const label of loadedRates.missing) glassMissing.push(`ставка «${label}»: нет в справочнике, взята заводская`)

  // ── Фурнитура + количества + цена — движок конфигуратора ─────────────────────
  const [{ data: { library, rates, kits }, finance }, funds] = await Promise.all([resolveTierData('budget'), loadOrderFundSettings()])
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

  const byId = new Map(library.items.map(i => [i.id, i]))
  const doors = assembly.glass.flatMap((g, i) => g.role !== 'door' ? [] : [{
    w: Math.round(body.panels?.[i]?.w || g.size[0] * 1000),
    h: Math.round(body.panels?.[i]?.h || g.size[1] * 1000),
  }])
  const kit = kits[body.model] ?? { slots: [] }
  // Уплотнитель и заглушку движок набирает из нескольких хлыстов — цена верна, но стык
  // менеджер должен видеть до заказа: у поставщика может быть длина подлиннее.
  const spliced = price.lines.flatMap(l => {
    const longest = Math.max(0, ...(byId.get(l.itemId)?.stocks ?? []).map(st => st.len))
    // Жёсткий профиль и трубу не стыкуют: их кусок длиннее хлыста — остановка (missing), не пометка.
    if (l.unit !== 'хлыст' || longest <= 0 || !canSplice(l.role)) return []
    return piecesForRole(q, kit, l.role).filter(p => p > longest).map(p => ({ label: l.label, piece: Math.round(p), stock: longest }))
  })
  const { stops, notes } = buildStops({
    lines: price.lines.map(l => ({ ...l, specs: l.itemId ? byId.get(l.itemId)?.specs : undefined })),
    missing: price.missing,
    drawn: body.drawn,
    doors, thicknessMm: thickness, swingDoors: q.swingDoors,
    heightMm: body.dims.height, heightRange: model.constraints.height, spliced,
  })
  // Цена для цели «остаётся с заказа» (Ш1). Менеджеру — только две цены для светофора:
  // ставки фондов и сдельная из ответа не уходят (они в /cfo).
  const modelTarget = kit.target
  const targetPct = modelTarget ?? funds.targetPct
  const complete = price.complete && glassMissing.length === 0
  const tp = complete && targetPct != null
    ? targetPrices({
        materials: price.glassCost + price.hardwareCost, glassCount: assembly.glass.length,
        orderItems: Math.max(1, Math.round(body.orderItems ?? 1)), partnerKnown: !!body.partner,
        rates: funds.rates, targetPct,
      })
    : null
  return {
    ...price, missing, complete,
    glassSource: glassMat ? glassMat.name : null,
    glassThickness: glassMat ? glassMat.thickness : thickness,
    glassDiscountPct: mgDiscount,
    glassLines,
    glassSubstituted,
    stops, notes,
    target: tp ? { ...tp, source: modelTarget != null ? 'модель' as const : 'план CFO' as const } : null,
  }
}
