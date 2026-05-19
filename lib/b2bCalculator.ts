import type { B2BMaterial, B2BService } from './types'

export const VAT = 22  // ставка НДС, %

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
  costEdge: number
  costTransport: number
  costPackaging: number
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

  const costWithVatBase = costMaterial + costTempering + costEdge + costTransport + costPackaging

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

  const saleIncVat = baseSaleIncVat + servicesCost
  const saleExVat  = Math.round(saleIncVat * 100 / (100 + VAT))
  const outputVat  = saleIncVat - saleExVat

  // Наценка с учётом полных затрат включая услуги
  const margin = saleExVat > 0 ? Math.round((1 - costExVatFull / saleExVat) * 100) : 0

  return {
    materialId: mat.id, materialName: mat.name, category: mat.category,
    thickness: mat.thickness, width, height, quantity, wastePercent, hasTempering, services,
    areaPiece, totalAreaNet, totalAreaBilled, perimeterM,
    weightPerM2, totalWeight,
    costMaterial, costTempering, costEdge, costTransport, costPackaging,
    costWithVat: costWithVatFull, inputVat: inputVatFull, costExVat: costExVatFull,
    pricePerM2, margin, vatRate: VAT, servicesCost, baseSaleExVat,
    saleExVat, outputVat, saleIncVat,
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
