// Whitelist-проекция расчёта для партнёра. ЕДИНСТВЕННОЕ место, где решается, что
// видит партнёр. Всё, что связано с себестоимостью/маржой (cost*/inputVat/margin/
// profit/vatToState/pricePerM2/*ExVat), НИКОГДА не сериализуется наружу.
//
// Инвариант: партнёрский API отдаёт только результат sanitize*, а не сырой items из
// b2b_orders (там зашита себестоимость калькулятора lib/b2bCalculator.ts).

import type { B2BOrderItem, B2BOrderTotals } from '@/lib/b2bCalculator'

// Клиентская проекция позиции — только то, что можно показать заказчику.
export type PartnerLineView = {
  materialName: string
  category: string
  thickness: number
  width: number
  height: number
  quantity: number
  hasTempering: boolean
  hasFacet: boolean
  areaM2: number
  saleIncVat: number   // цена клиенту с НДС (после скидки клиента)
}

export type PartnerTotalsView = {
  totalAfterDiscount: number
  totalAreaNet: number
  totalWeight: number
  itemsCount: number
}

export function sanitizeLine(i: B2BOrderItem): PartnerLineView {
  return {
    materialName: i.materialName,
    category: i.category,
    thickness: i.thickness,
    width: i.width,
    height: i.height,
    quantity: i.quantity,
    hasTempering: !!i.hasTempering,
    hasFacet: !!i.hasFacet,
    areaM2: i.totalAreaNet,
    saleIncVat: i.saleIncVat,
  }
}

export function sanitizeTotals(t: B2BOrderTotals, itemsCount: number): PartnerTotalsView {
  return {
    totalAfterDiscount: t.totalAfterDiscount,
    totalAreaNet: t.totalAreaNet,
    totalWeight: t.totalWeight,
    itemsCount,
  }
}

// Санитизация массива позиций (например, при чтении сохранённого просчёта партнёра).
export function sanitizeItems(items: unknown): PartnerLineView[] {
  if (!Array.isArray(items)) return []
  return items.map(x => sanitizeLine(x as B2BOrderItem))
}
