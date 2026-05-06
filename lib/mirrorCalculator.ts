import { Material, Service } from './types'

export type MirrorShape = 'rectangle' | 'circle' | 'oval' | 'complex'

export type MirrorInputs = {
  width: number
  height: number
  mirrorMaterial: Material | null
  shape: MirrorShape
  hasLighting: boolean
  buttonType: 'none' | 'sensor' | 'wave'  // none=0₽, sensor=сенсорная 400₽, wave=взмах 800₽
  hasSandblast: boolean
  hasSubstrate: boolean
  substratePrice: number  // default 2000
  hasInstallation: boolean
  hasDelivery: boolean
  partnerPercent: number
  discount: number
  margin: number        // default 40
  standardMargin: number // базовая маржа для расчёта бонуса менеджера, default 40
  tax: number           // default 11
  minMargin: number     // default 25
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
  perimeter: number
  costLines: CostLine[]
  totalCost: number
  // expensesPercent/expensesAmount mapped to tax for backwards compat with history page
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
  managerBaseCommission: number  // 2% от цены продажи — базовый заработок
  managerUpsellBonus: number     // 20% от прибыли сверх стандартной маржи
  managerBonus: number           // итого менеджеру = base + upsell
  belowMinMargin: boolean
  clientText: string
}

function findMat(materials: Material[], name: string): Material | undefined {
  return materials.find(m => m.name.toLowerCase().includes(name.toLowerCase()) && m.active)
}

export function calculateMirror(
  inputs: MirrorInputs,
  materials: Material[],
  services: Service[],
): MirrorResult | null {
  if (!inputs.mirrorMaterial || inputs.width <= 0 || inputs.height <= 0) return null

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

  // Зеркало (с коэффициентом за высоту > 2800 мм)
  // Используем sale_price как расчётную цену; cost_price — только закупка
  const mirrorCalcPrice = inputs.mirrorMaterial.sale_price ?? inputs.mirrorMaterial.cost_price
  const mirrorArea = inputs.height > 2800 ? area * 1.2 : area
  lines.push({
    name:  inputs.mirrorMaterial.name,
    qty:   Number(mirrorArea.toFixed(3)),
    unit:  'м²',
    price: mirrorCalcPrice,
    total: Math.round(mirrorArea * mirrorCalcPrice),
  })

  // Подсветка
  if (inputs.hasLighting) {
    const led      = findMat(materials, 'LED-лента')
    const profile  = findMat(materials, 'Профиль 20×20')
    const diffuser = findMat(materials, 'Рассеиватель')
    const psu      = findMat(materials, 'Блок питания')

    if (led)      lines.push({ name: led.name,      qty: Number(perimeter.toFixed(2)), unit: 'пог.м', price: led.cost_price,      total: Math.round(perimeter * led.cost_price) })
    if (profile)  lines.push({ name: profile.name,  qty: Number(perimeter.toFixed(2)), unit: 'пог.м', price: profile.cost_price,  total: Math.round(perimeter * profile.cost_price) })
    if (diffuser) lines.push({ name: diffuser.name, qty: Number(perimeter.toFixed(2)), unit: 'пог.м', price: diffuser.cost_price, total: Math.round(perimeter * diffuser.cost_price) })
    if (psu)      lines.push({ name: psu.name,      qty: 1,                            unit: 'шт',    price: psu.cost_price,      total: psu.cost_price })
  }

  // Кнопка включения
  if (inputs.buttonType === 'wave') {
    const sensor = findMat(materials, 'Датчик взмаха')
    const price = sensor?.cost_price ?? 800
    lines.push({ name: sensor?.name ?? 'Датчик взмаха', qty: 1, unit: 'шт', price, total: price })
  } else if (inputs.buttonType === 'sensor') {
    const btn = findMat(materials, 'Сенсорная кнопка')
    const price = btn?.cost_price ?? 400
    lines.push({ name: btn?.name ?? 'Сенсорная кнопка', qty: 1, unit: 'шт', price, total: price })
  }

  // Комплектующие
  const kit = findMat(materials, 'Комплектующие зеркала')
  if (kit) lines.push({ name: kit.name, qty: 1, unit: 'шт', price: kit.cost_price, total: kit.cost_price })

  // Сборка
  const assembly = inputs.hasSandblast
    ? findMat(materials, 'Сборка зеркала с пескоструем')
    : findMat(materials, 'Сборка зеркала')
  if (assembly) lines.push({ name: assembly.name, qty: 1, unit: 'шт', price: assembly.cost_price, total: assembly.cost_price })

  // Пескоструй
  if (inputs.hasSandblast) {
    const sb = findMat(materials, 'Пескоструй')
    if (sb) lines.push({ name: sb.name, qty: Number(area.toFixed(3)), unit: 'м²', price: sb.cost_price, total: Math.round(area * sb.cost_price) })
  }

  // Подложка
  if (inputs.hasSubstrate && inputs.substratePrice > 0) {
    lines.push({ name: 'Подложка', qty: 1, unit: 'шт', price: inputs.substratePrice, total: inputs.substratePrice })
  }

  // Сложная форма
  if (inputs.shape === 'complex') {
    lines.push({ name: 'Сложная форма', qty: 1, unit: 'шт', price: 1500, total: 1500 })
  }

  const totalCost = lines.reduce((s, l) => s + l.total, 0)

  // Формула: цена = себестоимость / (1 − маржа − налог)
  const marginDecimal = inputs.margin / 100
  const taxDecimal    = inputs.tax    / 100
  const denom         = 1 - marginDecimal - taxDecimal
  if (denom <= 0) return null

  const basePrice    = totalCost / denom
  console.log('[mirror] cost:', totalCost, 'margin:', inputs.margin, 'tax:', inputs.tax, 'price:', Math.round(basePrice))
  const taxAmount    = Math.round(basePrice * taxDecimal)
  const marginAmount = Math.round(basePrice * marginDecimal)

  // Партнёрка
  const partnerDecimal   = inputs.partnerPercent / 100
  const priceWithPartner = partnerDecimal > 0 ? basePrice / (1 - partnerDecimal) : basePrice
  const partnerAmount    = Math.round(priceWithPartner - basePrice)

  // Скидка
  const discountDecimal = inputs.discount / 100
  const finalPrice      = Math.round(priceWithPartner * (1 - discountDecimal))
  const discountAmount  = Math.round(priceWithPartner - finalPrice)

  // Реальная маржа и прибыль после скидки
  const taxOnFinal = Math.round(finalPrice * taxDecimal)
  const profit     = Math.round(finalPrice - totalCost - taxOnFinal)
  const realMargin = finalPrice > 0 ? (profit / finalPrice) * 100 : 0

  // Услуги (не входят в себестоимость — считаются отдельно)
  const serviceLines: ServiceLine[] = []
  if (inputs.hasInstallation) {
    const svc = services.find(s => s.name.toLowerCase().includes('монтаж зеркала'))
    if (svc) {
      const price = svc.sale_price ?? svc.cost_price
      serviceLines.push({ name: svc.name, qty: 1, unit: 'шт', total: Math.round(price) })
    }
  }
  if (inputs.hasDelivery) {
    const svc = services.find(s => s.name.toLowerCase().includes('доставка'))
    if (svc) {
      const price = svc.sale_price ?? svc.cost_price
      serviceLines.push({ name: svc.name, qty: 1, unit: 'заказ', total: Math.round(price) })
    }
  }

  const servicesTotal = serviceLines.reduce((s, l) => s + l.total, 0)
  const grandTotal    = finalPrice + servicesTotal

  const belowMinMargin = realMargin < inputs.minMargin

  // Базовый заработок менеджера: 2% от финальной цены с любой продажи
  const managerBaseCommission = Math.round(finalPrice * 0.02)

  // Бонус от надбавки: 20% от прибыли сверх стандартной маржи
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

  // Клиентский текст
  const matName  = inputs.mirrorMaterial.name
  const shapeStr =
    inputs.shape === 'circle'  ? 'круглое'  :
    inputs.shape === 'oval'    ? 'овальное' :
    inputs.shape === 'complex' ? 'фигурное' : 'прямоугольное'
  const dims =
    inputs.shape === 'circle' ? `Ø${inputs.width} мм` :
    `${inputs.width} × ${inputs.height} мм`

  const textParts: string[] = []

  // Заголовок — тип + габариты + форма
  textParts.push(`${matName} | ${dims} | ${shapeStr}`)

  // Подсветка
  if (inputs.hasLighting) {
    if (inputs.hasSandblast) {
      textParts.push('Подсветка фронтальная — свет проходит сквозь матовый рисунок')
    } else {
      textParts.push('Подсветка аура — мягкое свечение по периметру за зеркалом')
    }
  }

  // Пескоструй
  if (inputs.hasSandblast) {
    textParts.push('Пескоструйный рисунок по стеклу')
  }

  // Кнопка включения
  if (inputs.buttonType === 'wave') {
    textParts.push('Включение — бесконтактный датчик взмаха руки')
  } else if (inputs.buttonType === 'sensor') {
    textParts.push('Включение — сенсорная кнопка')
  }

  // Услуги
  for (const s of serviceLines) {
    textParts.push(`${s.name} — ${s.total.toLocaleString('ru-RU')} ₽`)
  }

  // Цена
  textParts.push('')
  if (servicesTotal > 0) {
    textParts.push(`Стоимость изделия: ${finalPrice.toLocaleString('ru-RU')} ₽`)
    textParts.push(`Итого с услугами: ${grandTotal.toLocaleString('ru-RU')} ₽`)
  } else {
    textParts.push(`Стоимость: ${finalPrice.toLocaleString('ru-RU')} ₽`)
  }

  const clientText = textParts.join('\n')

  return {
    area:            Number(area.toFixed(3)),
    perimeter:       Number(perimeter.toFixed(2)),
    costLines:       lines,
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
    clientText,
  }
}
