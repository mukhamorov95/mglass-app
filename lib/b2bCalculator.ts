import type { B2BMaterial, B2BService } from './types'

export const VAT = 22  // ставка НДС, %

export type FacetPrice = {
  id?: number
  type_mm: number        // 10, 15 или 20
  cost_price: number     // себестоимость подрядчика ₽/м.п.
  transport_cost: number // транспортные расходы ₽/м.п.
  sale_price: number     // продажная цена клиенту ₽/м.п.
  active?: boolean
}

// Закалка по толщине, ₽/м² (с НДС)
export const TEMPERING_COST: Record<number, number> = {
  4: 300,
  5: 350,
  6: 400,
  8: 500,
  10: 600,
  12: 950,
}

export const EDGE_COST_PER_M    = 40   // кромка, ₽/м.п.
export const TRANSPORT_PER_PIECE = 77  // доставка на закалку, ₽/шт
export const PACKAGING_PER_M2   = 120  // гофракартон ₽/м²

export const WASTE_OPTIONS = [
  { value: 10, label: '10% — проходной' },
  { value: 15, label: '15% — стандарт' },
  { value: 18, label: '18% — зеркало' },
  { value: 20, label: '20% — тонированное' },
  { value: 22, label: '22% — сатин' },
  { value: 25, label: '25% — декоративное' },
  { value: 30, label: '30% — рифлёное' },
  { value: 35, label: '35% — рифлёное с узором' },
  { value: 40, label: '40% — рифлёное MORU' },
  { value: 45, label: '45% — рифлёное Ультра' },
  { value: 50, label: '50% — специальный' },
]

// Минимальная стоимость позиции за штуку (₽, вкл. НДС)
export const MIN_LINE_PRICES = {
  glass_tempering:     2500,
  tinted_tempering:    3000,
  mirror_no_tempering: 1500,
  narrow_detail:       3000,
} as const

export type MinPriceReason = keyof typeof MIN_LINE_PRICES

function isTintedOrSpecialMaterial(category: string): boolean {
  return ['тонированное', 'сатин', 'рифленое', 'декоративное'].includes(category)
}

export function resolveMinLinePrice(
  category: string,
  width: number,
  height: number,
  hasTempering: boolean,
): { minPricePerPiece: number; reason: MinPriceReason } | null {
  if (Math.min(width, height) < 250) {
    return { minPricePerPiece: MIN_LINE_PRICES.narrow_detail, reason: 'narrow_detail' }
  }
  if (hasTempering && isTintedOrSpecialMaterial(category)) {
    return { minPricePerPiece: MIN_LINE_PRICES.tinted_tempering, reason: 'tinted_tempering' }
  }
  if (hasTempering) {
    return { minPricePerPiece: MIN_LINE_PRICES.glass_tempering, reason: 'glass_tempering' }
  }
  if (category === 'зеркало') {
    return { minPricePerPiece: MIN_LINE_PRICES.mirror_no_tempering, reason: 'mirror_no_tempering' }
  }
  return null
}

export type ItemService = {
  id: number
  name: string
  type: 'percent' | 'per_m2' | 'fixed' | 'calculated' | 'film'
  value: number
  cost: number
  costPrice: number
}

export type B2BOrderItem = {
  localId: string
  comment?: string
  materialId: number
  materialName: string
  category: string
  thickness: number
  width: number
  height: number
  quantity: number
  wastePercent: number
  hasTempering: boolean
  hasFacet: boolean
  facetTypeMm: number | null
  hasHoles?: boolean        // нужна сверловка — влияет на маршрут производства (lib/productionRouting.ts)
  shape?: 'rect' | 'curved' // криволинейный рез — зарезервировано, пока не влияет на маршрут (нет отдельной станции)
  hasTriplex?: boolean      // триплекс/склейка — зарезервировано, пока не влияет на маршрут (нет отдельной станции)
  services: ItemService[]
  // площадь
  areaPiece: number
  totalAreaNet: number
  totalAreaBilled: number
  perimeterM: number
  // вес
  weightPerM2: number
  totalWeight: number
  // себестоимость (все с НДС, т.к. покупаем с НДС)
  costMaterial: number
  costTempering: number
  costFacet: number
  costEdge: number
  costTransport: number
  costPackaging: number
  saleFacet: number
  costWithVat: number
  inputVat: number
  costExVat: number
  // продажа (цена из прайса — финальная цена клиента вкл. НДС)
  pricePerM2: number      // цена из прайса ₽/м²
  margin: number          // расчётная наценка %
  vatRate: number
  servicesCost: number    // доп. услуги (итого)
  baseSaleExVat: number   // продажа без услуг и без НДС
  saleExVat: number       // продажа с услугами, без НДС
  outputVat: number
  saleIncVat: number      // итого к оплате клиентом
  // минимальная стоимость строки (когда деталь слишком мала)
  minPriceApplied?:   boolean
  minPriceReason?:    MinPriceReason
  originalLinePrice?: number
  minLinePrice?:      number
  minPriceDelta?:     number
}

export type B2BOrderTotals = {
  totalAreaNet: number
  totalWeight: number
  totalCostExVat: number
  totalInputVat: number
  totalCostWithVat: number
  totalSaleExVat: number
  totalOutputVat: number
  totalSaleIncVat: number
  totalAfterDiscount: number
  vatToState: number
  profit: number
}

export function calcItem(
  mat: B2BMaterial,
  width: number,
  height: number,
  quantity: number,
  wastePercent: number,
  hasTempering: boolean = false,
  selectedServices: B2BService[] = [],
  hasFacet: boolean = false,
  facetTypeMm: number | null = null,
  facetPrices: FacetPrice[] = [],
): Omit<B2BOrderItem, 'localId'> {
  const areaPiece       = r4(width * height / 1_000_000)
  const totalAreaNet    = r4(areaPiece * quantity)
  const totalAreaBilled = r4(totalAreaNet * (1 + wastePercent / 100))
  const perimeterM      = r3(2 * (width + height) / 1000)

  const weightPerM2 = mat.thickness * 2.5
  const totalWeight = r2(totalAreaNet * weightPerM2)

  // Себестоимость — все цены С НДС 22%
  const costMaterial  = Math.round(totalAreaBilled * mat.cost_price)
  const costTempering = hasTempering
    ? Math.round(totalAreaNet * (TEMPERING_COST[mat.thickness] ?? 0))
    : 0
  const costEdge      = Math.round(perimeterM * quantity * EDGE_COST_PER_M)
  const costTransport = Math.round(quantity * TRANSPORT_PER_PIECE)
  const costPackaging = Math.round(totalAreaNet * PACKAGING_PER_M2)

  const facetPrice = hasFacet && facetTypeMm
    ? facetPrices.find(f => f.type_mm === facetTypeMm)
    : undefined
  const costFacet = facetPrice
    ? Math.round(perimeterM * quantity * (facetPrice.cost_price + facetPrice.transport_cost))
    : 0
  const saleFacet = facetPrice
    ? Math.round(perimeterM * quantity * facetPrice.sale_price)
    : 0

  const costWithVatBase = costMaterial + costTempering + costFacet + costEdge + costTransport + costPackaging

  // Продажа — цена из прайса (финальная цена клиента, вкл. НДС)
  const pricePerM2     = mat.sale_price ?? 0
  const baseSaleIncVat = Math.round(pricePerM2 * totalAreaNet)
  const baseSaleExVat  = Math.round(baseSaleIncVat * 100 / (100 + VAT))

  // Доп. услуги: цена продажи + закупочная себестоимость
  const services: ItemService[] = selectedServices.map(s => {
    let cost = 0
    if (s.type === 'percent') cost = Math.round(baseSaleIncVat * s.value / 100)
    else if (s.type === 'per_m2') cost = Math.round(totalAreaNet * s.value)
    else if (s.type === 'fixed') cost = Math.round(s.value * quantity)

    // Закупочная себестоимость услуги
    let costPrice = 0
    if (s.type === 'per_m2') costPrice = Math.round(totalAreaNet * (s.cost_price ?? 0))
    else if (s.type === 'fixed') costPrice = Math.round((s.cost_price ?? 0) * quantity)
    // percent: себестоимость не задаётся напрямую

    return { id: s.id, name: s.name, type: s.type, value: s.value, cost, costPrice }
  })
  const servicesCost = services.reduce((sum, s) => sum + s.cost, 0)
  const servicesCostPrice = services.reduce((sum, s) => sum + s.costPrice, 0)

  // Итоговая себестоимость с учётом закупочной стоимости услуг
  const costWithVatFull = costWithVatBase + servicesCostPrice
  const inputVatFull    = Math.round(costWithVatFull * VAT / (100 + VAT))
  const costExVatFull   = costWithVatFull - inputVatFull

  let saleIncVat = baseSaleIncVat + servicesCost + saleFacet

  // Применяем минимальную стоимость строки (per-piece × quantity)
  const minResolved = resolveMinLinePrice(mat.category, width, height, hasTempering)
  let minPriceApplied: boolean | undefined
  let minPriceReason:  MinPriceReason | undefined
  let originalLinePrice: number | undefined
  let minLinePrice:    number | undefined
  let minPriceDelta:   number | undefined

  if (minResolved) {
    const minTotal = minResolved.minPricePerPiece * quantity
    if (saleIncVat < minTotal) {
      originalLinePrice = saleIncVat
      minLinePrice      = minTotal
      minPriceDelta     = minTotal - saleIncVat
      saleIncVat        = minTotal
      minPriceApplied   = true
      minPriceReason    = minResolved.reason
    }
  }

  const saleExVat  = Math.round(saleIncVat * 100 / (100 + VAT))
  const outputVat  = saleIncVat - saleExVat

  // Наценка с учётом полных затрат включая услуги
  const margin = saleExVat > 0 ? Math.round((1 - costExVatFull / saleExVat) * 100) : 0

  return {
    materialId: mat.id, materialName: mat.name, category: mat.category,
    thickness: mat.thickness, width, height, quantity, wastePercent, hasTempering,
    hasFacet, facetTypeMm: hasFacet ? (facetTypeMm ?? null) : null, services,
    areaPiece, totalAreaNet, totalAreaBilled, perimeterM,
    weightPerM2, totalWeight,
    costMaterial, costTempering, costFacet, costEdge, costTransport, costPackaging, saleFacet,
    costWithVat: costWithVatFull, inputVat: inputVatFull, costExVat: costExVatFull,
    pricePerM2, margin, vatRate: VAT, servicesCost, baseSaleExVat,
    saleExVat, outputVat, saleIncVat,
    ...(minPriceApplied ? { minPriceApplied, minPriceReason, originalLinePrice, minLinePrice, minPriceDelta } : {}),
  }
}

export function calcTotals(items: B2BOrderItem[], discountPercent: number): B2BOrderTotals {
  const totalAreaNet       = r3(items.reduce((s, i) => s + i.totalAreaNet, 0))
  const totalWeight        = r2(items.reduce((s, i) => s + i.totalWeight, 0))
  const totalCostExVat     = Math.round(items.reduce((s, i) => s + i.costExVat, 0))
  const totalInputVat      = Math.round(items.reduce((s, i) => s + i.inputVat, 0))
  const totalCostWithVat   = totalCostExVat + totalInputVat
  const totalSaleExVat     = Math.round(items.reduce((s, i) => s + i.saleExVat, 0))
  const totalOutputVat     = Math.round(items.reduce((s, i) => s + i.outputVat, 0))
  const totalSaleIncVat    = totalSaleExVat + totalOutputVat
  const totalAfterDiscount = Math.round(totalSaleIncVat * (1 - discountPercent / 100))
  const vatToState         = totalOutputVat - totalInputVat
  const profit             = totalAfterDiscount - totalCostWithVat

  return {
    totalAreaNet, totalWeight,
    totalCostExVat, totalInputVat, totalCostWithVat,
    totalSaleExVat, totalOutputVat, totalSaleIncVat,
    totalAfterDiscount, vatToState, profit,
  }
}

function r2(n: number) { return Math.round(n * 100) / 100 }
function r3(n: number) { return Math.round(n * 1000) / 1000 }
function r4(n: number) { return Math.round(n * 10000) / 10000 }
