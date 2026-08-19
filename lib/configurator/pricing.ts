import { calcFinancialModel } from '@/lib/pricing/financialModel'
import type { Assembly } from '@/components/configurator/scene/assembly'

// Расчёт цены изделия для визуализатора. Переиспользует движок «Быстрого расчёта»:
// себестоимость (стекло + фурнитура) → Цена = Себест / (1 − маржа − налог) через
// канонический calcFinancialModel; монтаж×секции + доставка + подъём добавляются
// СВЕРХУ (работы/логистика не наценяются). Количества берутся из 3D-геометрии.

// ── Количества из геометрии ───────────────────────────────────────
export type Quantities = {
  thickness: number
  sections: number                    // число полотен — для монтажа (6500 × секции)
  glassM2: number                     // площадь стекла, м²
  profileM: number                    // погонаж П-профиля Pr-002, м.п.
  tubeM: number                       // погонаж штанги 30×10, м.п.
  hardware: Record<string, number>    // штуки по модели: {balge:3, sd210:1, roller:4, ...}
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function computeQuantities(assembly: Assembly, thickness: number): Quantities {
  const glassM2 = round2(assembly.glass.reduce((s, g) => s + g.size[0] * g.size[1], 0))
  const profileM = round2(assembly.metal.filter(m => m.kind === 'profile').reduce((s, m) => s + m.size[0], 0))
  const tubeM = round2(assembly.metal.filter(m => m.kind === 'rail').reduce((s, m) => s + m.size[0], 0))
  const hardware: Record<string, number> = {}
  for (const h of assembly.hardware) hardware[h.model] = (hardware[h.model] ?? 0) + 1
  return { thickness, sections: assembly.glass.length, glassM2, profileM, tubeM, hardware }
}

// ── Прайс единиц (СЕБЕСТОИМОСТЬ). Плейсхолдеры — вынести в настройки (админ) ──
export type UnitPrices = {
  glassPerM2: Record<number, number>   // ₽/м² по толщине
  hardware: Record<string, number>     // ₽/шт по модели фурнитуры
  profilePerM: number                  // Pr-002, ₽/м.п.
  tubePerM: number                     // штанга 30×10, ₽/м.п.
  installPerSection: number            // монтаж за секцию, ₽
  deliveryMoscow: number               // доставка по Москве, ₽
  liftPerFloor: number                 // подъём за этаж, ₽
}

// ВНИМАНИЕ: это дефолты себестоимости (плейсхолдеры). Реальные — из настроек/Supabase.
// Подтверждено владельцем: монтаж 6500/секция, доставка Москва 5000.
export const DEFAULT_UNIT_PRICES: UnitPrices = {
  glassPerM2: { 8: 3200, 10: 4200 },
  hardware: {
    balge: 2500, dessau: 4000, sd210: 1500, kupe: 600, roller: 800,
    kp006: 400, kp002: 350, kp001: 500, connector: 400, cap: 100,
  },
  profilePerM: 250,
  tubePerM: 600,
  installPerSection: 6500,
  deliveryMoscow: 5000,
  liftPerFloor: 0,
}

export const DEFAULT_FINANCE = { marginPct: 40, taxPct: 12 }

export const HARDWARE_LABEL: Record<string, string> = {
  balge: 'Петля Balge-004', dessau: 'Петля Dessau-103', sd210: 'Ручка-скоба SD-210',
  kupe: 'Ручка-купе КУ-002', roller: 'Ролик РД-001', kp006: 'Крепёж КП-006 (стекло)',
  kp002: 'Крепёж КП-002 (стена)', kp001: 'Крепёж КП-001 (угол)', connector: 'Соединитель трубы', cap: 'Заглушка',
}

// ── Расчёт цены ───────────────────────────────────────────────────
export type PriceLine = { key: string; label: string; qty: number; unit: string; unitPrice: number; total: number }
export type PriceResult = {
  glassCost: number
  hardwareLines: PriceLine[]
  hardwareCost: number
  profileCost: number
  tubeCost: number
  materialsCost: number          // себестоимость стекла + фурнитуры + профиля
  itemPrice: number              // Цена изделия = Себест / (1 − маржа − налог)
  sections: number
  installCost: number            // монтаж × секции
  deliveryCost: number
  liftCost: number
  total: number                  // Сумма изделия
  marginPct: number
  taxPct: number
}

export type PriceOptions = { withDelivery?: boolean; floors?: number }

export function computePrice(
  q: Quantities,
  up: UnitPrices = DEFAULT_UNIT_PRICES,
  finance = DEFAULT_FINANCE,
  opts: PriceOptions = {},
): PriceResult {
  const glassRate = up.glassPerM2[q.thickness] ?? up.glassPerM2[8] ?? 0
  const glassCost = Math.round(q.glassM2 * glassRate)

  const hardwareLines: PriceLine[] = Object.entries(q.hardware).map(([model, qty]) => {
    const unitPrice = up.hardware[model] ?? 0
    return { key: model, label: HARDWARE_LABEL[model] ?? model, qty, unit: 'шт', unitPrice, total: Math.round(qty * unitPrice) }
  })
  const hardwareCost = hardwareLines.reduce((s, l) => s + l.total, 0)
  const profileCost = Math.round(q.profileM * up.profilePerM)
  const tubeCost = Math.round(q.tubeM * up.tubePerM)
  const materialsCost = glassCost + hardwareCost + profileCost + tubeCost

  const fm = calcFinancialModel({ directCost: materialsCost, marginPercent: finance.marginPct, taxPercent: finance.taxPct })
  const itemPrice = fm?.finalPrice ?? 0

  const installCost = up.installPerSection * q.sections
  const deliveryCost = opts.withDelivery === false ? 0 : up.deliveryMoscow
  const liftCost = (opts.floors ?? 0) * up.liftPerFloor
  const total = itemPrice + installCost + deliveryCost + liftCost

  return {
    glassCost, hardwareLines, hardwareCost, profileCost, tubeCost, materialsCost,
    itemPrice, sections: q.sections, installCost, deliveryCost, liftCost, total,
    marginPct: finance.marginPct, taxPct: finance.taxPct,
  }
}

// Клиенту — округлённая «от N ₽» (без копеек, до сотен вниз).
export function clientPriceFrom(total: number): number {
  return Math.floor(total / 100) * 100
}
