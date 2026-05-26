import { Material, Service, MirrorFrame, calcFrameCost } from './types'

export type MirrorShape = 'rectangle' | 'circle' | 'oval' | 'complex'

export type MirrorLightingComponent = {
  id: number
  name: string
  short_name?: string | null
  cost_price: number
  unit: string
  voltage?: number | null
  color_temp?: number | null
  power_per_meter?: number | null
  max_power?: number | null
}

export type MirrorInputs = {
  width: number
  height: number
  mirrorMaterial: Material | null
  mirrorCostPerM2?: number | null   // sale price from glass_price_matrix; overrides mirrorMaterial.sale_price
  mirrorWastePct?: number           // base waste % from glass_price_matrix
  shapeModifierPct?: number         // extra waste % from material_waste_modifiers
  shape: MirrorShape

  // Modular lighting
  hasLighting: boolean
  voltage?: 12 | 24
  frame?: MirrorLightingComponent | null
  ledStrip?: MirrorLightingComponent | null
  powerSupply?: MirrorLightingComponent | null
  diffuser?: MirrorLightingComponent | null

  mirrorFrame?: MirrorFrame | null   // decorative frame (NOT lighting frame)
  frameAssemblyMinuteRate?: number      // cost ₽/мин from production_settings
  frameAssemblySaleMinuteRate?: number  // sale ₽/мин = cost × (1+overhead%) × (1+margin%)
  buttonType: 'none' | 'sensor' | 'wave'
  hasSandblast: boolean
  hasSubstrate: boolean
  substratePrice: number
  hasFacet: boolean
  facetTypeMm: number | null
  facetCostPerM: number   // итоговая себестоимость ₽/м.п. (cost_price + transport_cost)
  facetSalePerM: number   // продажная цена клиенту ₽/м.п.
  hasInstallation: boolean
  hasDelivery: boolean
  deliveryCost?: number
  partnerPercent: number
  discount: number
  margin: number
  standardMargin: number
  tax: number
  minMargin: number
}

export type CostLine = {
  name: string
  qty: number
  unit: string
  price: number
  total: number
}

export type ServiceLine = {
  name: string
  qty: number
  unit: string
  total: number
}

export type MirrorResult = {
  area: number
  billingArea: number
  baseWastePct: number
  shapeModifierPct: number
  totalWastePct: number
  perimeter: number
  costLines: CostLine[]
  totalCost: number
  expensesPercent: number
  expensesAmount: number
  marginAmount: number
  basePrice: number
  partnerAmount: number
  priceWithPartner: number
  discountAmount: number
  finalPrice: number
  serviceLines: ServiceLine[]
  servicesTotal: number
  grandTotal: number
  margin: number
  profit: number
  managerBaseCommission: number
  managerUpsellBonus: number
  managerBonus: number
  belowMinMargin: boolean
  clientText: string
}

function findMat(materials: Material[], name: string): Material | undefined {
  return materials.find(m => m.name.toLowerCase().includes(name.toLowerCase()) && m.active)
}

function dn(m: { name: string; short_name?: string | null }): string {
  return m.short_name?.trim() || m.name
}

export function calculateMirror(
  inputs: MirrorInputs,
  materials: Material[],
  services: Service[],
): MirrorResult | null {
  if (inputs.width <= 0 || inputs.height <= 0) return null
  if (!inputs.mirrorMaterial && !(inputs.mirrorCostPerM2 != null && inputs.mirrorCostPerM2 > 0)) return null

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

  const lines: CostLine[] = []

  // Mirror material
  const mirrorCalcPrice =
    inputs.mirrorCostPerM2 != null && inputs.mirrorCostPerM2 > 0
      ? inputs.mirrorCostPerM2
      : (inputs.mirrorMaterial?.sale_price ?? inputs.mirrorMaterial?.cost_price ?? 0)

  const baseWastePct  = inputs.mirrorWastePct ?? 0
  const shapeModPct   = inputs.shapeModifierPct ?? 0
  const heightModPct  = inputs.height > 2800 ? 20 : 0
  const totalWastePct = baseWastePct + shapeModPct + heightModPct
  const billingArea   = area * (1 + totalWastePct / 100)

  lines.push({
    name:  inputs.mirrorMaterial ? dn(inputs.mirrorMaterial) : 'Зеркало',
    qty:   Number(billingArea.toFixed(3)),
    unit:  'м²',
    price: mirrorCalcPrice,
    total: Math.round(billingArea * mirrorCalcPrice),
  })

  // Modular lighting system
  // Complex shapes don't use a rectangular profile frame (assembled on substrate instead)
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
  }

  // Button
  if (inputs.buttonType === 'wave') {
    const sensor = findMat(materials, 'Датчик взмаха')
    const price = sensor?.cost_price ?? 800
    lines.push({ name: sensor ? dn(sensor) : 'Датчик взмаха', qty: 1, unit: 'шт', price, total: price })
  } else if (inputs.buttonType === 'sensor') {
    const btn = findMat(materials, 'Сенсорная кнопка')
    const price = btn?.cost_price ?? 400
    lines.push({ name: btn ? dn(btn) : 'Сенсорная кнопка', qty: 1, unit: 'шт', price, total: price })
  }

  // Mirror kit accessories
  const kit = findMat(materials, 'Комплектующие зеркала')
  if (kit) lines.push({ name: dn(kit), qty: 1, unit: 'шт', price: kit.cost_price, total: kit.cost_price })

  // Assembly
  const assembly = inputs.hasSandblast
    ? (findMat(materials, 'Сборка зеркала с пескоструем') ?? findMat(materials, 'Сборка зеркала'))
    : findMat(materials, 'Сборка зеркала')
  if (assembly) lines.push({ name: dn(assembly), qty: 1, unit: 'шт', price: assembly.cost_price, total: assembly.cost_price })

  // Sandblasting
  if (inputs.hasSandblast) {
    const sb = findMat(materials, 'Пескоструй')
    const sbPrice = sb ? sb.cost_price : 1200
    const sbName  = sb ? dn(sb) : 'Пескоструйный рисунок'
    lines.push({ name: sbName, qty: Number(area.toFixed(3)), unit: 'м²', price: sbPrice, total: Math.round(area * sbPrice) })
  }

  // Substrate
  if (inputs.hasSubstrate && inputs.substratePrice > 0) {
    lines.push({ name: 'Подложка', qty: 1, unit: 'шт', price: inputs.substratePrice, total: inputs.substratePrice })
  }

  // Facet (bevel edge) — per running meter of perimeter
  if (inputs.hasFacet && inputs.facetCostPerM > 0) {
    lines.push({
      name:  `Фацет ${inputs.facetTypeMm ?? ''}мм`,
      qty:   Number(perimeter.toFixed(2)),
      unit:  'пог.м',
      price: inputs.facetCostPerM,
      total: Math.round(perimeter * inputs.facetCostPerM),
    })
  }

  // Complex shape surcharge
  if (inputs.shape === 'complex') {
    lines.push({ name: 'Сложная форма', qty: 1, unit: 'шт', price: 1500, total: 1500 })
  }

  // Decorative frame
  if (inputs.mirrorFrame) {
    const fc = calcFrameCost(inputs.mirrorFrame, inputs.width, inputs.height, inputs.frameAssemblyMinuteRate, inputs.frameAssemblySaleMinuteRate)
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
      price: Math.round(fc.totalMinutes > 0 ? fc.assemblySale / fc.totalMinutes : 0),
      total: fc.assemblySale,
    })
  }

  const totalCost = lines.reduce((s, l) => s + l.total, 0)

  const marginDecimal = inputs.margin / 100
  const taxDecimal    = inputs.tax    / 100
  const denom         = 1 - marginDecimal - taxDecimal
  if (denom <= 0) return null

  const basePrice    = totalCost / denom
  const taxAmount    = Math.round(basePrice * taxDecimal)
  const marginAmount = Math.round(basePrice * marginDecimal)

  const partnerDecimal   = inputs.partnerPercent / 100
  const priceWithPartner = partnerDecimal > 0 ? basePrice / (1 - partnerDecimal) : basePrice
  const partnerAmount    = Math.round(priceWithPartner - basePrice)

  const discountDecimal = inputs.discount / 100
  const finalPrice      = Math.round(priceWithPartner * (1 - discountDecimal))
  const discountAmount  = Math.round(priceWithPartner - finalPrice)

  const taxOnFinal = Math.round(finalPrice * taxDecimal)
  const profit     = Math.round(finalPrice - totalCost - taxOnFinal)
  const realMargin = finalPrice > 0 ? (profit / finalPrice) * 100 : 0

  // Services
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
  const grandTotal    = finalPrice + servicesTotal
  const belowMinMargin = realMargin < inputs.minMargin

  const managerBaseCommission = Math.round(finalPrice * 0.02)
  const stdDenom = 1 - inputs.standardMargin / 100 - taxDecimal
  let managerUpsellBonus = 0
  if (stdDenom > 0 && inputs.margin > inputs.standardMargin) {
    const stdBase        = totalCost / stdDenom
    const stdWithPartner = partnerDecimal > 0 ? stdBase / (1 - partnerDecimal) : stdBase
    const stdFinal       = Math.round(stdWithPartner * (1 - discountDecimal))
    const extraRev       = Math.max(0, finalPrice - stdFinal)
    const taxOnExtra     = Math.round(extraRev * taxDecimal)
    managerUpsellBonus   = Math.round((extraRev - taxOnExtra) * 0.10)
  }
  const managerBonus = managerBaseCommission + managerUpsellBonus

  // Client text
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
    textParts.push(`Стоимость изделия:\n${finalPrice.toLocaleString('ru-RU')} ₽`)
    textParts.push('')
    textParts.push(`Итого с услугами:\n${grandTotal.toLocaleString('ru-RU')} ₽`)
  } else {
    textParts.push(`Стоимость:\n${finalPrice.toLocaleString('ru-RU')} ₽`)
  }

  return {
    area:             Number(area.toFixed(3)),
    billingArea:      Number(billingArea.toFixed(3)),
    baseWastePct,
    shapeModifierPct: shapeModPct,
    totalWastePct,
    perimeter:        Number(perimeter.toFixed(2)),
    costLines:        lines,
    totalCost,
    expensesPercent: inputs.tax,
    expensesAmount:  taxAmount,
    marginAmount,
    basePrice:       Math.round(basePrice),
    partnerAmount,
    priceWithPartner: Math.round(priceWithPartner),
    discountAmount,
    finalPrice,
    serviceLines,
    servicesTotal,
    grandTotal,
    margin:          Number(realMargin.toFixed(1)),
    profit,
    managerBaseCommission,
    managerUpsellBonus,
    managerBonus,
    belowMinMargin,
    clientText: textParts.join('\n'),
  }
}
