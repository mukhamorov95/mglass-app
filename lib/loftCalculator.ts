import { Material, Service, HardwareItem, FinancialSettings } from './types'

export type LoftSystemType = 'fixed' | 'sliding' | 'swing'

export type LoftInputs = {
  width: number        // мм, общая ширина перегородки
  height: number       // мм, высота
  sections: number     // количество секций (вертикальных делений)
  divisions: number    // количество горизонтальных делений внутри секции
  systemType: LoftSystemType
  glassMaterial: Material | null
  withTempering: boolean
  withMirrorFilm: boolean
  withPainting: boolean
  hasInstallation: boolean
  hasDelivery: boolean
  hardware: HardwareItem[]  // выбранная фурнитура
  hardwareQty: Record<number, number>  // id → количество
  partnerPercent: number
  discount: number
  margin: number
}

export type CostLine = {
  name: string
  qty: number
  unit: string
  price: number
  total: number
  note?: string
}

export type LoftResult = {
  area: number          // м², общая площадь
  glassArea: number     // м², площадь стекла
  metalLength: number   // пог.м, длина профиля
  штапикLength: number  // пог.м
  costLines: CostLine[]
  totalCost: number
  expensesPercent: number
  expensesAmount: number
  basePrice: number
  partnerAmount: number
  priceWithPartner: number
  discountAmount: number
  finalPrice: number
  serviceLines: { name: string; total: number }[]
  servicesTotal: number
  grandTotal: number
  margin: number
  profit: number
  belowMinMargin: boolean
  clientText: string
}

function find(materials: Material[], name: string): Material | undefined {
  return materials.find(m => m.name.toLowerCase().includes(name.toLowerCase()) && m.active)
}

export function calculateLoft(
  inputs: LoftInputs,
  materials: Material[],
  services: Service[],
  settings: FinancialSettings
): LoftResult | null {
  if (inputs.width <= 0 || inputs.height <= 0) return null

  const W = inputs.width   // мм
  const H = inputs.height  // мм
  const S = Math.max(1, inputs.sections)
  const D = Math.max(0, inputs.divisions)

  // Геометрия
  const area = (W * H) / 1_000_000  // м²

  // Длина металлического профиля (пог.м):
  // Внешний контур + вертикальные стойки + горизонтальные перемычки
  const outerFrame = 2 * (W + H)                   // мм
  const verticalPosts = (S - 1) * H                 // мм
  const horizontalBars = D * W                      // мм (перемычки на всю ширину)
  const metalMm = outerFrame + verticalPosts + horizontalBars
  const metalLength = metalMm / 1000                // пог.м

  // Площадь стекла ≈ 85% от общей (вычитаем профиль ~25 мм с каждой стороны)
  const frameWidth = 0.025  // м
  const sectionW = W / 1000 / S
  const sectionH = H / 1000 / (D + 1)
  const openingW = Math.max(0, sectionW - 2 * frameWidth)
  const openingH = Math.max(0, sectionH - 2 * frameWidth)
  const openingsCount = S * (D + 1)
  const glassArea = openingW * openingH * openingsCount

  // Штапик — периметр всех проёмов
  const штапикLength = 2 * (openingW + openingH) * openingsCount

  const lines: CostLine[] = []

  // Профиль 40×20
  const profile = find(materials, 'Профиль 40×20')
  if (profile) {
    lines.push({
      name: profile.name,
      qty: Number(metalLength.toFixed(2)),
      unit: 'пог.м',
      price: profile.cost_price,
      total: Math.round(metalLength * profile.cost_price),
      note: `контур + ${S - 1} стойк. + ${D} перемыч.`,
    })
  }

  // Штапик 15×15
  const штапик = find(materials, 'Штапик 15×15')
  if (штапик) {
    lines.push({
      name: штапик.name,
      qty: Number(штапикLength.toFixed(2)),
      unit: 'пог.м',
      price: штапик.cost_price,
      total: Math.round(штапикLength * штапик.cost_price),
    })
  }

  // Уплотнитель
  const sealant = find(materials, 'Уплотнитель')
  if (sealant) {
    lines.push({
      name: sealant.name,
      qty: Number(штапикLength.toFixed(2)),
      unit: 'пог.м',
      price: sealant.cost_price,
      total: Math.round(штапикLength * sealant.cost_price),
    })
  }

  // Расходники
  const consumables = find(materials, 'Производственные расходники лофт')
  if (consumables) {
    lines.push({
      name: consumables.name,
      qty: Number(area.toFixed(3)),
      unit: 'м²',
      price: consumables.cost_price,
      total: Math.round(area * consumables.cost_price),
    })
  }

  // Работа сварщика
  const welder = find(materials, 'Работа сварщика лофт')
  if (welder) {
    lines.push({
      name: welder.name,
      qty: Number(area.toFixed(3)),
      unit: 'м²',
      price: welder.cost_price,
      total: Math.round(area * welder.cost_price),
    })
  }

  // Сборка лофт
  const assembly = find(materials, 'Сборка лофт')
  if (assembly) {
    lines.push({
      name: assembly.name,
      qty: Number(area.toFixed(3)),
      unit: 'м²',
      price: assembly.cost_price,
      total: Math.round(area * assembly.cost_price),
    })
  }

  // Стекло
  if (inputs.glassMaterial && glassArea > 0) {
    lines.push({
      name: inputs.glassMaterial.name,
      qty: Number(glassArea.toFixed(3)),
      unit: 'м²',
      price: inputs.glassMaterial.cost_price,
      total: Math.round(glassArea * inputs.glassMaterial.cost_price),
    })
  }

  // Закалка
  if (inputs.withTempering && glassArea > 0) {
    const tempering = services.find(s => s.name.toLowerCase().includes('закалка'))
    if (tempering) {
      lines.push({
        name: tempering.name,
        qty: Number(glassArea.toFixed(3)),
        unit: 'м²',
        price: tempering.cost_price,
        total: Math.round(glassArea * tempering.cost_price),
      })
    }
  }


  // Покраска
  if (inputs.withPainting) {
    const paintMin = services.find(s => s.name.toLowerCase().includes('покраска') && s.name.toLowerCase().includes('мин'))
    const paintSqm = services.find(s => s.name.toLowerCase().includes('покраска лофт') && !s.name.toLowerCase().includes('мин'))
    if (paintSqm) {
      const paintCost = Math.max(
        paintMin?.cost_price ?? 10000,
        area * paintSqm.cost_price
      )
      const isMin = paintCost === (paintMin?.cost_price ?? 10000)
      lines.push({
        name: 'Покраска',
        qty: isMin ? 1 : Number(area.toFixed(3)),
        unit: isMin ? 'заказ (минимум)' : 'м²',
        price: isMin ? paintCost : paintSqm.cost_price,
        total: Math.round(paintCost),
      })
    }
  }

  // Фурнитура
  for (const hw of inputs.hardware) {
    const qty = inputs.hardwareQty[hw.id] ?? 1
    if (qty > 0 && (hw.cost_price ?? 0) > 0) {
      lines.push({
        name: hw.name,
        qty,
        unit: hw.unit,
        price: hw.cost_price ?? 0,
        total: Math.round(qty * (hw.cost_price ?? 0)),
      })
    }
  }

  const totalCost = lines.reduce((s, l) => s + l.total, 0)

  // Финансовая модель
  const expensesPercent = settings.tax_percent

  const marginDecimal = inputs.margin / 100
  const expensesDecimal = expensesPercent / 100

  if (1 - expensesDecimal - marginDecimal <= 0) return null
  const basePrice = totalCost / (1 - expensesDecimal - marginDecimal)
  const expensesAmount = Math.round(basePrice * expensesDecimal)

  const partnerDecimal = inputs.partnerPercent / 100
  const priceWithPartner = partnerDecimal > 0 ? basePrice / (1 - partnerDecimal) : basePrice
  const partnerAmount = Math.round(priceWithPartner - basePrice)

  const discountDecimal = inputs.discount / 100
  const finalPrice = Math.round(priceWithPartner * (1 - discountDecimal))
  const discountAmount = Math.round(priceWithPartner - finalPrice)

  const realMargin = ((finalPrice - totalCost - expensesAmount) / finalPrice) * 100
  const profit = Math.round(finalPrice - totalCost - expensesAmount)

  const systemNames: Record<LoftSystemType, string> = {
    fixed: 'глухая',
    sliding: 'раздвижная',
    swing: 'распашная',
  }

  const extras = [
    inputs.withTempering && 'закалённое стекло',
    inputs.withMirrorFilm && 'зеркальная плёнка',
    inputs.withPainting && 'окраска',
  ].filter(Boolean).join(', ')

  // Услуги (монтаж, доставка) — сверх цены изделия
  const serviceLines: { name: string; total: number }[] = []
  if (inputs.withMirrorFilm && glassArea > 0) {
    const filmSvc = services.find(s => s.name.toLowerCase().includes('зеркальная плёнка') || s.name.toLowerCase().includes('зеркальная пленка'))
    const filmPricePerM2 = filmSvc ? (filmSvc.sale_price ?? filmSvc.cost_price) : 2500
    serviceLines.push({ name: `Зеркальная плёнка (${glassArea.toFixed(2)} м²)`, total: Math.round(glassArea * filmPricePerM2) })
  }

  if (inputs.hasInstallation) {
    const svc = services.find(s => s.name.toLowerCase().includes('монтаж лофт') || s.name.toLowerCase().includes('монтаж перегородки'))
    if (svc) serviceLines.push({ name: `${svc.name} (${S} секц.)`, total: (svc.sale_price ?? svc.cost_price) * S })
  }
  if (inputs.hasDelivery) {
    const svc = services.find(s => s.name.toLowerCase().includes('доставка'))
    if (svc) serviceLines.push({ name: svc.name, total: svc.sale_price ?? svc.cost_price })
  }
  const servicesTotal = serviceLines.reduce((s, l) => s + l.total, 0)
  const grandTotal = finalPrice + servicesTotal

  const clientText =
    `Лофт-перегородка ${W}×${H} мм, ${systemNames[inputs.systemType]}.\n` +
    `${S} секц., ${D} горизонт. делений${inputs.glassMaterial ? `, ${inputs.glassMaterial.name}` : ''}${extras ? `, ${extras}` : ''}.\n` +
    `Площадь: ${area.toFixed(2)} м².\n\n` +
    `Стоимость изделия: ${finalPrice.toLocaleString('ru-RU')} ₽` +
    (servicesTotal > 0 ? `\nУслуги: ${serviceLines.map(s => `${s.name} ${s.total.toLocaleString('ru-RU')} ₽`).join(', ')}\nИтого: ${grandTotal.toLocaleString('ru-RU')} ₽` : '')

  return {
    area: Number(area.toFixed(3)),
    glassArea: Number(glassArea.toFixed(3)),
    metalLength: Number(metalLength.toFixed(2)),
    штапикLength: Number(штапикLength.toFixed(2)),
    costLines: lines,
    totalCost,
    expensesPercent,
    expensesAmount,
    basePrice: Math.round(basePrice),
    partnerAmount,
    priceWithPartner: Math.round(priceWithPartner),
    discountAmount,
    finalPrice,
    serviceLines,
    servicesTotal,
    grandTotal,
    margin: Number(realMargin.toFixed(1)),
    profit,
    belowMinMargin: realMargin < settings.min_margin,
    clientText,
  }
}
