// Unified mirror calculator — M-Glass V2 financial model.
//
// Principle: every ingredient enters directCost strictly via its cost_price.
// One markup, one place: calcFinancialModel applies
//   basePrice = directCost / (1 - margin - tax)
// to the whole basket. No sale_price reads, no hardcoded fallbacks, no
// per-component markup. Services (mount/delivery) stay above directCost,
// identical to the existing calculator, so the grandTotal composition is
// the only thing comparable apples-to-apples with the live calc.
//
// Live price still flows through lib/mirrorCalculator.ts — this module is
// not wired to UI in this step. It is consumed only by the V2 preview path.

import type { Material, Service, MirrorFrame } from '@/lib/types'
import { calcFrameCost } from '@/lib/types'
import type { MirrorLightingComponent, MirrorShape } from '@/lib/mirrorCalculator'
import { calcFinancialModel } from './financialModel'

export type CostLine = {
  name:  string
  qty:   number
  unit:  string
  price: number
  total: number
}

export type ServiceLine = {
  name:  string
  qty:   number
  unit:  string
  total: number
}

export type CalculateMirrorUnifiedInputs = {
  width:  number
  height: number
  shape:  MirrorShape

  // Mirror substrate — read via cost_price. Optional explicit cost override
  // comes from glass_price_matrix COST row (not sale row).
  mirrorMaterial:           Material | null
  mirrorCostPriceCostRow?:  number | null
  mirrorWastePct?:          number
  shapeModifierPct?:        number

  // Modular lighting components — all priced via component.cost_price.
  hasLighting: boolean
  voltage?:    12 | 24
  frame?:       MirrorLightingComponent | null
  ledStrip?:    MirrorLightingComponent | null
  powerSupply?: MirrorLightingComponent | null
  diffuser?:    MirrorLightingComponent | null

  // Decorative frame — uses cost-rate for assembly (NOT sale-rate).
  mirrorFrame?:             MirrorFrame | null
  frameAssemblyMinuteRate?: number

  buttonType:   'none' | 'sensor' | 'wave'
  hasSandblast: boolean
  hasSubstrate: boolean
  substratePrice: number   // already cost in UI
  hasFacet:       boolean
  facetTypeMm:    number | null
  facetCostPerM:  number   // cost_price + transport_cost from facet_prices

  hasInstallation: boolean
  hasDelivery:     boolean
  deliveryCost?:   number

  partnerPercent:  number
  discount:        number
  margin:          number
  standardMargin:  number
  tax:             number
  minMargin:       number

  // Production cost extensions (V2 two-stage factory cost). Optional — when
  // omitted, directCost stays identical to the pre-extension behavior so the
  // existing v2-preview / financial check keep working unchanged.
  productionConfig?: {
    factoryOverheadPercent: number   // % to materials subtotal
    scrapReservePercent:    number   // % to materials subtotal
    packagingCostPerM2:     number   // ₽ per billingArea m²
  }
}

export type CalculateMirrorUnifiedResult = {
  area:             number
  billingArea:      number
  baseWastePct:     number
  shapeModifierPct: number
  totalWastePct:    number
  perimeter:        number

  costLines:    CostLine[]
  directCost:   number     // sum of all costLines.total (== financial.directCost)

  // From calcFinancialModel — single source of truth for the markup:
  basePrice:        number
  taxAmount:        number
  marginAmount:     number
  partnerAmount:    number
  priceWithPartner: number
  discountAmount:   number
  finalPrice:       number
  taxOnFinal:       number
  profit:           number

  // Services (mount / delivery) — above directCost, by sale_price as before.
  serviceLines:  ServiceLine[]
  servicesTotal: number
  grandTotal:    number

  margin:          number   // effectiveMarginPercent from financial model
  belowMinMargin:  boolean

  managerBaseCommission: number
  managerUpsellBonus:    number
  managerBonus:          number

  clientText: string
}

function findMat(materials: Material[], name: string): Material | undefined {
  return materials.find(m => m.name.toLowerCase().includes(name.toLowerCase()) && m.active)
}

function dn(m: { name: string; short_name?: string | null }): string {
  return m.short_name?.trim() || m.name
}

export function calculateMirrorUnified(
  inputs: CalculateMirrorUnifiedInputs,
  materials: Material[],
  services: Service[],
): CalculateMirrorUnifiedResult | null {
  if (inputs.width <= 0 || inputs.height <= 0) return null

  // Cost source for mirror substrate: explicit cost-row override OR material.cost_price.
  // Important: sale_price is intentionally NOT consulted here — V2 puts margin in
  // exactly one place (calcFinancialModel), not in two.
  const explicitCost = inputs.mirrorCostPriceCostRow
  const mirrorCalcPrice =
    explicitCost != null && explicitCost > 0
      ? explicitCost
      : (inputs.mirrorMaterial?.cost_price ?? 0)
  if (mirrorCalcPrice <= 0) return null

  // Geometry
  let area: number
  let perimeter: number
  if (inputs.shape === 'circle') {
    const r = Math.min(inputs.width, inputs.height) / 2 / 1000
    area      = Math.PI * r * r
    perimeter = 2 * Math.PI * r
  } else if (inputs.shape === 'oval') {
    const a = inputs.width / 2 / 1000
    const b = inputs.height / 2 / 1000
    area = Math.PI * a * b
    const h = Math.pow(a - b, 2) / Math.pow(a + b, 2)
    perimeter = Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)))
  } else {
    area      = (inputs.width * inputs.height) / 1_000_000
    perimeter = (2 * (inputs.width + inputs.height)) / 1000
  }

  const baseWastePct  = inputs.mirrorWastePct ?? 0
  const shapeModPct   = inputs.shapeModifierPct ?? 0
  const heightModPct  = inputs.height > 2800 ? 20 : 0
  const totalWastePct = baseWastePct + shapeModPct + heightModPct
  const billingArea   = area * (1 + totalWastePct / 100)

  const lines: CostLine[] = []

  // 1. Mirror substrate
  lines.push({
    name:  inputs.mirrorMaterial ? dn(inputs.mirrorMaterial) : 'Зеркало',
    qty:   Number(billingArea.toFixed(3)),
    unit:  'м²',
    price: mirrorCalcPrice,
    total: Math.round(billingArea * mirrorCalcPrice),
  })

  // 2. Modular lighting — each component by its own cost_price.
  if (inputs.hasLighting) {
    if (inputs.frame && inputs.shape !== 'complex') {
      lines.push({
        name:  dn(inputs.frame),
        qty:   Number(perimeter.toFixed(2)),
        unit:  'пог.м',
        price: inputs.frame.cost_price,
        total: Math.round(perimeter * inputs.frame.cost_price),
      })
    }
    if (inputs.ledStrip) {
      lines.push({
        name:  dn(inputs.ledStrip),
        qty:   Number(perimeter.toFixed(2)),
        unit:  'пог.м',
        price: inputs.ledStrip.cost_price,
        total: Math.round(perimeter * inputs.ledStrip.cost_price),
      })
    }
    if (inputs.powerSupply) {
      lines.push({
        name:  dn(inputs.powerSupply),
        qty:   1,
        unit:  'шт',
        price: inputs.powerSupply.cost_price,
        total: inputs.powerSupply.cost_price,
      })
    }
    if (inputs.diffuser && inputs.diffuser.cost_price > 0) {
      lines.push({
        name:  dn(inputs.diffuser),
        qty:   Number(perimeter.toFixed(2)),
        unit:  'пог.м',
        price: inputs.diffuser.cost_price,
        total: Math.round(perimeter * inputs.diffuser.cost_price),
      })
    }
    // Lighting consumables — provod, термоусадка, разъёмы, изоляция и т.д.
    // Засеяны в commit 38f727a (V2-only, is_v2_only=true; live их не видит).
    const lightingConsumables = findMat(materials, 'Расходники подсветки')
    if (lightingConsumables && lightingConsumables.cost_price > 0) {
      lines.push({
        name:  dn(lightingConsumables),
        qty:   1,
        unit:  lightingConsumables.unit || 'шт',
        price: lightingConsumables.cost_price,
        total: lightingConsumables.cost_price,
      })
    }
  }

  // 3. Button — no hardcoded fallback. Missing material = no row,
  //    surfacing the gap in the directory instead of papering over it.
  if (inputs.buttonType === 'wave') {
    const sensor = findMat(materials, 'Датчик взмаха')
    if (sensor) {
      lines.push({ name: dn(sensor), qty: 1, unit: 'шт', price: sensor.cost_price, total: sensor.cost_price })
    }
  } else if (inputs.buttonType === 'sensor') {
    const btn = findMat(materials, 'Сенсорная кнопка')
    if (btn) {
      lines.push({ name: dn(btn), qty: 1, unit: 'шт', price: btn.cost_price, total: btn.cost_price })
    }
  }

  // 4. Mirror kit accessories
  const kit = findMat(materials, 'Комплектующие зеркала')
  if (kit) {
    lines.push({ name: dn(kit), qty: 1, unit: 'шт', price: kit.cost_price, total: kit.cost_price })
  }

  // 5. Assembly — branch order: lighting first, then sandblast, then plain.
  //    No fallback line when a material is missing.
  let assembly: Material | undefined
  if (inputs.hasLighting) {
    assembly =
      findMat(materials, 'Сборка зеркала с подсветкой') ??
      (inputs.hasSandblast
        ? (findMat(materials, 'Сборка зеркала с пескоструем') ?? findMat(materials, 'Сборка зеркала'))
        : findMat(materials, 'Сборка зеркала'))
  } else if (inputs.hasSandblast) {
    assembly = findMat(materials, 'Сборка зеркала с пескоструем') ?? findMat(materials, 'Сборка зеркала')
  } else {
    assembly = findMat(materials, 'Сборка зеркала')
  }
  if (assembly) {
    lines.push({ name: dn(assembly), qty: 1, unit: 'шт', price: assembly.cost_price, total: assembly.cost_price })
  }

  // 6. Sandblasting — no 1200 fallback.
  if (inputs.hasSandblast) {
    const sb = findMat(materials, 'Пескоструй')
    if (sb) {
      lines.push({
        name:  dn(sb),
        qty:   Number(area.toFixed(3)),
        unit:  'м²',
        price: sb.cost_price,
        total: Math.round(area * sb.cost_price),
      })
    }
  }

  // 7. Substrate (already cost from UI)
  if (inputs.hasSubstrate && inputs.substratePrice > 0) {
    lines.push({ name: 'Подложка', qty: 1, unit: 'шт', price: inputs.substratePrice, total: inputs.substratePrice })
  }

  // 8. Facet — facetCostPerM = cost_price + transport_cost from facet_prices
  if (inputs.hasFacet && inputs.facetCostPerM > 0) {
    lines.push({
      name:  `Фацет ${inputs.facetTypeMm ?? ''}мм`,
      qty:   Number(perimeter.toFixed(2)),
      unit:  'пог.м',
      price: inputs.facetCostPerM,
      total: Math.round(perimeter * inputs.facetCostPerM),
    })
  }

  // 9. Complex shape surcharge — only allowed hardcode (per V2 spec).
  if (inputs.shape === 'complex') {
    lines.push({ name: 'Сложная форма', qty: 1, unit: 'шт', price: 1500, total: 1500 })
  }

  // 10. Decorative frame — both profile AND assembly enter at COST rate.
  //     Passing saleMinuteRate := costMinuteRate keeps the frame cost-only.
  if (inputs.mirrorFrame) {
    const costRate = inputs.frameAssemblyMinuteRate
    const fc = calcFrameCost(inputs.mirrorFrame, inputs.width, inputs.height, costRate, costRate)
    lines.push({
      name:  `Профиль рамки ${inputs.mirrorFrame.name}`,
      qty:   fc.whipsNeeded,
      unit:  'хлыст',
      price: Math.round(fc.whipsNeeded > 0 ? fc.profileCost / fc.whipsNeeded : 0),
      total: fc.profileCost,
    })
    lines.push({
      name:  'Сборка рамки',
      qty:   fc.totalMinutes,
      unit:  'мин',
      price: Math.round(fc.totalMinutes > 0 ? fc.assemblyCost / fc.totalMinutes : 0),
      total: fc.assemblyCost,
    })
  }

  // 11–13. Production cost extensions (V2 only). Applied to materials subtotal
  //        BEFORE the financial markup so the resulting directCost reflects the
  //        full production cost (Factory Cost) — input for the two-stage model.
  //
  // Convention: packaging is its own line (₽/м² × billingArea); scrap reserve
  // and factory overhead are computed as % of the *materials subtotal* only
  // (lines 1–10) — they do NOT compound on each other or on packaging, so the
  // order of these three lines in the output array does not affect totals.
  //
  // TODO: combined "Сборка зеркала с подсветкой и пескоструем" — пока берётся
  // приоритет hasLighting > hasSandblast в материале «Сборка зеркала с
  // подсветкой». При появлении отдельной комбинированной позиции — добавить
  // в ветке выше (шаг 5).
  if (inputs.productionConfig) {
    const cfg = inputs.productionConfig
    const materialsSubtotal = lines.reduce((s, l) => s + l.total, 0)

    if (cfg.packagingCostPerM2 > 0 && billingArea > 0) {
      lines.push({
        name:  'Упаковка',
        qty:   Number(billingArea.toFixed(3)),
        unit:  'м²',
        price: cfg.packagingCostPerM2,
        total: Math.round(billingArea * cfg.packagingCostPerM2),
      })
    }
    if (cfg.scrapReservePercent > 0 && materialsSubtotal > 0) {
      const total = Math.round(materialsSubtotal * cfg.scrapReservePercent / 100)
      if (total > 0) {
        lines.push({
          name:  `Резерв брака ${cfg.scrapReservePercent}%`,
          qty:   1,
          unit:  '%',
          price: total,
          total,
        })
      }
    }
    if (cfg.factoryOverheadPercent > 0 && materialsSubtotal > 0) {
      const total = Math.round(materialsSubtotal * cfg.factoryOverheadPercent / 100)
      if (total > 0) {
        lines.push({
          name:  `Накладные производства ${cfg.factoryOverheadPercent}%`,
          qty:   1,
          unit:  '%',
          price: total,
          total,
        })
      }
    }
  }

  const directCost = lines.reduce((s, l) => s + l.total, 0)

  // Unified financial model — single markup point.
  const fm = calcFinancialModel({
    directCost,
    marginPercent:   inputs.margin,
    taxPercent:      inputs.tax,
    partnerPercent:  inputs.partnerPercent,
    discountPercent: inputs.discount,
  })
  if (!fm) return null

  // Services (mount / delivery) — sit ABOVE directCost. Kept on sale_price
  // so the V2 grandTotal stays comparable to the live grandTotal.
  const serviceLines: ServiceLine[] = []
  if (inputs.hasInstallation) {
    const svc = services.find(s => s.name.toLowerCase().includes('монтаж зеркала'))
    if (svc) {
      const price = svc.sale_price ?? svc.cost_price
      serviceLines.push({ name: svc.name, qty: 1, unit: 'шт', total: Math.round(price) })
    }
  }
  if (inputs.hasDelivery) {
    if (inputs.deliveryCost != null && inputs.deliveryCost > 0) {
      serviceLines.push({ name: 'Доставка за МКАД', qty: 1, unit: 'заказ', total: inputs.deliveryCost })
    } else {
      const svc = services.find(s => s.name.toLowerCase().includes('доставка'))
      if (svc) {
        const price = svc.sale_price ?? svc.cost_price
        serviceLines.push({ name: svc.name, qty: 1, unit: 'заказ', total: Math.round(price) })
      }
    }
  }
  const servicesTotal = serviceLines.reduce((s, l) => s + l.total, 0)
  const grandTotal    = fm.finalPrice + servicesTotal
  const belowMinMargin = fm.effectiveMarginPercent < inputs.minMargin

  // Manager commission — 2% base on product, 10% upsell on margin above standard.
  // Standard scenario uses the SAME unified formula at standardMargin, so the
  // bonus base is consistent with how live price is built.
  const managerBaseCommission = Math.round(fm.finalPrice * 0.02)
  let managerUpsellBonus = 0
  if (inputs.margin > inputs.standardMargin) {
    const stdFm = calcFinancialModel({
      directCost,
      marginPercent:   inputs.standardMargin,
      taxPercent:      inputs.tax,
      partnerPercent:  inputs.partnerPercent,
      discountPercent: inputs.discount,
    })
    if (stdFm) {
      const extraRev   = Math.max(0, fm.finalPrice - stdFm.finalPrice)
      const taxDecimal = inputs.tax / 100
      const taxOnExtra = Math.round(extraRev * taxDecimal)
      managerUpsellBonus = Math.round((extraRev - taxOnExtra) * 0.10)
    }
  }
  const managerBonus = managerBaseCommission + managerUpsellBonus

  // Client text — same shape as live calculator, so manager-facing copy
  // and KP rendering keep their familiar layout.
  const matFullName = inputs.mirrorMaterial?.name ?? 'Зеркало'
  const shapeLabel =
    inputs.shape === 'circle'  ? 'Круглое'       :
    inputs.shape === 'oval'    ? 'Овальное'      :
    inputs.shape === 'complex' ? 'Сложная форма' : 'Прямоугольное'
  const dims = inputs.shape === 'circle'
    ? `Ø${inputs.width} мм`
    : `${inputs.width} × ${inputs.height} мм`

  const textParts: string[] = []
  textParts.push(`Зеркало ${matFullName}`)
  textParts.push('')
  textParts.push('Размер:')
  textParts.push(dims)
  textParts.push('')
  textParts.push('Форма:')
  textParts.push(shapeLabel)

  if (inputs.hasLighting) {
    textParts.push('')
    textParts.push('Подсветка:')
    if (inputs.ledStrip) {
      let ledLine = dn(inputs.ledStrip)
      if (inputs.ledStrip.power_per_meter) ledLine += ` ${inputs.ledStrip.power_per_meter}W/м`
      if (inputs.ledStrip.color_temp)      ledLine += ` ${inputs.ledStrip.color_temp}K`
      textParts.push(ledLine)
    }
    textParts.push(inputs.hasSandblast ? 'свет сквозь матовый рисунок' : 'мягкое свечение по периметру')
  }
  if (inputs.hasLighting && inputs.frame && inputs.shape !== 'complex') {
    textParts.push('')
    textParts.push('Каркас:')
    textParts.push(dn(inputs.frame))
  }
  if (inputs.mirrorFrame) {
    const colorMap: Record<string, string> = { black: 'чёрная', white: 'белая', graphite: 'графитовая', gold: 'золотая', brush: 'браш', chrome: 'хром', custom: 'индивидуальный цвет' }
    const colorLabel = colorMap[inputs.mirrorFrame.color] ?? inputs.mirrorFrame.color
    const frameDesc = [inputs.mirrorFrame.frame_type, colorLabel, inputs.mirrorFrame.profile_size].filter(Boolean).join(' ')
    textParts.push('')
    textParts.push('Рамка:')
    textParts.push(frameDesc)
  }

  const extras: string[] = []
  if (inputs.hasFacet && inputs.facetTypeMm)  extras.push(`Фацет ${inputs.facetTypeMm} мм`)
  if (inputs.hasSandblast)             extras.push('Пескоструйный рисунок')
  if (inputs.hasSubstrate)             extras.push('Подложка')
  if (inputs.buttonType === 'sensor')  extras.push('Сенсорная кнопка')
  if (inputs.buttonType === 'wave')    extras.push('Бесконтактный датчик взмаха')
  if (inputs.hasInstallation)          extras.push('Монтаж зеркала')
  if (inputs.hasDelivery)              extras.push('Доставка')
  if (extras.length > 0) {
    textParts.push('')
    textParts.push('Дополнительно:')
    extras.forEach(e => textParts.push(e))
  }

  textParts.push('')
  if (servicesTotal > 0) {
    textParts.push(`Стоимость изделия:\n${fm.finalPrice.toLocaleString('ru-RU')} ₽`)
    textParts.push('')
    textParts.push(`Итого с услугами:\n${grandTotal.toLocaleString('ru-RU')} ₽`)
  } else {
    textParts.push(`Стоимость:\n${fm.finalPrice.toLocaleString('ru-RU')} ₽`)
  }

  return {
    area:             Number(area.toFixed(3)),
    billingArea:      Number(billingArea.toFixed(3)),
    baseWastePct,
    shapeModifierPct: shapeModPct,
    totalWastePct,
    perimeter:        Number(perimeter.toFixed(2)),

    costLines:    lines,
    directCost,

    basePrice:        fm.basePrice,
    taxAmount:        fm.taxAmount,
    marginAmount:     fm.marginAmount,
    partnerAmount:    fm.partnerAmount,
    priceWithPartner: fm.priceWithPartner,
    discountAmount:   fm.discountAmount,
    finalPrice:       fm.finalPrice,
    taxOnFinal:       fm.taxOnFinal,
    profit:           fm.profit,

    serviceLines,
    servicesTotal,
    grandTotal,

    margin:         fm.effectiveMarginPercent,
    belowMinMargin,

    managerBaseCommission,
    managerUpsellBonus,
    managerBonus,

    clientText: textParts.join('\n'),
  }
}
