// Ценовой слой ограждений: геометрия (computeRailing) + ставки (railing_rates)
// → себестоимость (стекло + крепёж + монтаж + доставка) → цена клиенту.
// Наценка по канонической формуле: цена = себест / (1 − маржа − налог).

import type { RailingResult, RailingFixing } from './railingCalculator'
import { rate, type RailingRatesMap } from './railingRates'
import { calcFinancialModel } from './pricing/financialModel'

export type CostLine = { name: string; qty: number; unit: string; price: number; total: number }
export type ServiceLine = { name: string; total: number }

// Крепёж: точки/стойки — штуки, профиль — пог.метры. Количество предлагается по
// правилу из справочника (с запасом для профиля), менеджер может переопределить.
export type HardwareSuggestion = {
  kind: RailingFixing
  label: string
  unit: string          // 'шт' | 'пог.м'
  qty: number           // предложенное количество (с запасом)
  unitCost: number      // себест за единицу
}

const r1 = (n: number) => Math.round(n * 10) / 10

export function suggestHardware(
  fixing: RailingFixing,
  rates: RailingRatesMap,
  alongSlopeM: number,
): HardwareSuggestion {
  if (fixing === 'profile') {
    const reserve = 1 + rate(rates, 'profile_reserve_pct') / 100
    return {
      kind: 'profile',
      label: 'Профиль зажимной',
      unit: 'пог.м',
      qty: r1(alongSlopeM * reserve),
      unitCost: rate(rates, 'profile_per_m'),
    }
  }
  if (fixing === 'posts') {
    // стойки по правилу + одна крайняя
    const qty = Math.ceil(rate(rates, 'posts_per_m') * alongSlopeM) + 1
    return { kind: 'posts', label: 'Стойки', unit: 'шт', qty, unitCost: rate(rates, 'post_each') }
  }
  // points
  const qty = Math.ceil(rate(rates, 'points_per_m') * alongSlopeM)
  return { kind: 'points', label: 'Точки (крепление)', unit: 'шт', qty, unitCost: rate(rates, 'point_each') }
}

export type RailingPriceInputs = {
  geometry: RailingResult
  fixing: RailingFixing
  glassCostPerM2: number
  hardwareQty: number        // штук (точки/стойки) или пог.м (профиль) — уже с учётом ручной правки
  hardwareUnitCost: number   // себест за единицу (по умолчанию из справочника)
  hardwareLabel: string
  hardwareUnit: string
  withMount: boolean
  mountPerM: number          // себест монтажа ₽/пог.м
  withDelivery: boolean
  deliveryCost: number       // клиентская цена доставки (pass-through)
  marginPercent: number
  taxPercent: number
}

export type RailingPrice = {
  // Себестоимость (для менеджера)
  glassCost: number
  hardwareCost: number
  mountCost: number
  productCost: number        // стекло + крепёж
  costLines: CostLine[]      // детализация себестоимости изделия (стекло, крепёж)
  // Цена клиенту
  productPrice: number       // изделие (стекло+крепёж) с наценкой
  mountPrice: number         // монтаж с наценкой (себест → клиент)
  deliveryPrice: number      // доставка pass-through
  serviceLines: ServiceLine[]
  grandTotal: number         // изделие + монтаж + доставка
  margin: number
  profit: number
}

const money = (n: number) => Math.round(n)

// Наценка одной суммы: себест → цена клиенту по финмодели.
function markup(directCost: number, marginPercent: number, taxPercent: number): number {
  if (directCost <= 0) return 0
  const fin = calcFinancialModel({ directCost, marginPercent, taxPercent })
  return fin ? fin.basePrice : directCost
}

export function priceRailing(i: RailingPriceInputs): RailingPrice {
  const glassCost = i.geometry.blankM2 * i.glassCostPerM2
  const hardwareCost = i.hardwareQty * i.hardwareUnitCost
  const alongSlopeM = i.geometry.alongSlopeTotalM
  const mountCost = i.withMount ? alongSlopeM * i.mountPerM : 0

  const productCost = glassCost + hardwareCost

  const costLines: CostLine[] = [
    { name: `Стекло (заготовки ${r1(i.geometry.blankM2)} м²)`, qty: r1(i.geometry.blankM2), unit: 'м²', price: money(i.glassCostPerM2), total: money(glassCost) },
    { name: i.hardwareLabel, qty: i.hardwareQty, unit: i.hardwareUnit, price: money(i.hardwareUnitCost), total: money(hardwareCost) },
  ]

  const productPrice  = money(markup(productCost, i.marginPercent, i.taxPercent))
  const mountPrice    = i.withMount ? money(markup(mountCost, i.marginPercent, i.taxPercent)) : 0
  const deliveryPrice = i.withDelivery ? money(i.deliveryCost) : 0

  const serviceLines: ServiceLine[] = []
  if (mountPrice > 0)    serviceLines.push({ name: 'Монтаж', total: mountPrice })
  if (deliveryPrice > 0) serviceLines.push({ name: 'Доставка', total: deliveryPrice })

  const grandTotal = productPrice + mountPrice + deliveryPrice
  const directTotal = productCost + mountCost + (i.withDelivery ? i.deliveryCost : 0)
  const taxAmount = Math.round(grandTotal * (i.taxPercent / 100))
  const profit = grandTotal - directTotal - taxAmount
  const margin = grandTotal > 0 ? Math.round((profit / grandTotal) * 1000) / 10 : 0

  return {
    glassCost: money(glassCost),
    hardwareCost: money(hardwareCost),
    mountCost: money(mountCost),
    productCost: money(productCost),
    costLines,
    productPrice,
    mountPrice,
    deliveryPrice,
    serviceLines,
    grandTotal,
    margin,
    profit,
  }
}
