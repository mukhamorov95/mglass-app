import { calcFinancialModel } from '@/lib/pricing/financialModel'
import type { Assembly } from '@/components/configurator/scene/assembly'

// Расчёт цены изделия для визуализатора. Переиспользует движок «Быстрого расчёта»:
// себестоимость (стекло + фурнитура + профиль) → Цена = Себест / (1 − маржа − налог)
// через канонический calcFinancialModel; монтаж×секции + доставка + подъём — СВЕРХУ.
// Профиль/штанга считаются по ХЛЫСТАМ (2200/3000), фурнитура — по цвету. Данные —
// из геометрии (cut-list) × справочник цен (по тарифу бюджет/премиум).

export type Tier = 'budget' | 'premium'

// ── Количества из геометрии (cut-list) ────────────────────────────
export type Quantities = {
  thickness: number
  sections: number                    // число полотен — монтаж (₽ × секции)
  glassM2: number                     // площадь стекла, м²
  profilePieces: number[]             // куски П-профиля Pr-002, мм (для хлыстов)
  tubePieces: number[]                // куски штанги 30×10, мм (для хлыстов)
  hardware: Record<string, number>    // штуки по модели: {balge:3, sd210:1, roller:4, ...}
}

const round2 = (n: number) => Math.round(n * 100) / 100
const mm = (m: number) => Math.round(m * 1000)

export function computeQuantities(assembly: Assembly, thickness: number): Quantities {
  const glassM2 = round2(assembly.glass.reduce((s, g) => s + g.size[0] * g.size[1], 0))
  // Профиль Pr-002: горизонтальные (kind profile, длина = size[0]) + стойки (post, длина = высота size[1]).
  const profilePieces: number[] = [
    ...assembly.metal.filter(m => m.kind === 'profile').map(m => mm(m.size[0])),
    ...assembly.metal.filter(m => m.kind === 'post').map(m => mm(m.size[1])),
  ].filter(l => l > 0)
  // Штанга 30×10: верхние рельсы (kind rail, длина = size[0]).
  const tubePieces = assembly.metal.filter(m => m.kind === 'rail').map(m => mm(m.size[0])).filter(l => l > 0)
  const hardware: Record<string, number> = {}
  for (const h of assembly.hardware) hardware[h.model] = (hardware[h.model] ?? 0) + 1
  return { thickness, sections: assembly.glass.length, glassM2, profilePieces, tubePieces, hardware }
}

// ── Справочник цен (СЕБЕСТОИМОСТЬ). Плейсхолдеры — заполняются в админке/Supabase ──
export type Stock = { len: number; price: number }   // хлыст: длина мм → цена ₽
export type UnitPrices = {
  glassPerM2: Record<string, number>              // тип стекла → ₽/м² (8 мм)
  hardware: Record<string, Record<string, number>> // модель → цвет(finishId) → ₽/шт
  profileStock: Stock[]                            // Pr-002: хлысты 2200/3000
  tubeStock: Stock[]                               // штанга 30×10: хлысты 2200/3000
  installPerSection: number                        // монтаж за секцию
  deliveryMoscow: number                           // доставка по Москве
  liftPerFloor: number                             // подъём за этаж
}

export const GLASS_TYPE_IDS = ['clear', 'crystal', 'bronze', 'graphite'] as const
export const FINISH_IDS = ['chrome', 'satin', 'black', 'gunmetal', 'bronze', 'gold', 'brgold', 'white', 'rose', 'brrose'] as const
export const HARDWARE_MODELS = ['balge', 'dessau', 'sd210', 'kupe', 'roller', 'kp006', 'kp002', 'kp001', 'connector', 'cap'] as const

export const HARDWARE_LABEL: Record<string, string> = {
  balge: 'Петля Balge-004', dessau: 'Петля Dessau-103', sd210: 'Ручка-скоба SD-210',
  kupe: 'Ручка-купе КУ-002', roller: 'Ролик РД-001', kp006: 'Крепёж КП-006 (стекло)',
  kp002: 'Крепёж КП-002 (стена)', kp001: 'Крепёж КП-001 (угол)', connector: 'Соединитель трубы', cap: 'Заглушка',
}

// Наценка цвета к базовой цене фурнитуры (сид; в админке правится по позиции/цвету).
const COLOR_MULT: Record<string, number> = {
  chrome: 1, satin: 1.1, black: 1.25, gunmetal: 1.3, bronze: 1.3,
  gold: 1.45, brgold: 1.4, white: 1.15, rose: 1.5, brrose: 1.45,
}

function seedHardware(base: Record<string, number>): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {}
  for (const m of HARDWARE_MODELS) {
    out[m] = {}
    for (const c of FINISH_IDS) out[m][c] = Math.round((base[m] ?? 0) * (COLOR_MULT[c] ?? 1))
  }
  return out
}

// Бюджет и премиум — раздельные наборы цен. ВНИМАНИЕ: плейсхолдеры.
// Подтверждено владельцем: монтаж 6500/секц, доставка Москва 5000, хлысты 2200/3000.
export const PRICES: Record<Tier, UnitPrices> = {
  budget: {
    glassPerM2: { clear: 3200, crystal: 3900, bronze: 4600, graphite: 4600 },
    hardware: seedHardware({ balge: 2500, dessau: 4000, sd210: 1500, kupe: 600, roller: 800, kp006: 400, kp002: 350, kp001: 500, connector: 400, cap: 100 }),
    profileStock: [{ len: 2200, price: 520 }, { len: 3000, price: 690 }],
    tubeStock: [{ len: 2200, price: 900 }, { len: 3000, price: 1180 }],
    installPerSection: 6500, deliveryMoscow: 5000, liftPerFloor: 0,
  },
  premium: {
    glassPerM2: { clear: 3800, crystal: 4600, bronze: 5400, graphite: 5400 },
    hardware: seedHardware({ balge: 3600, dessau: 6900, sd210: 2200, kupe: 900, roller: 1100, kp006: 560, kp002: 480, kp001: 700, connector: 560, cap: 140 }),
    profileStock: [{ len: 2200, price: 620 }, { len: 3000, price: 820 }],
    tubeStock: [{ len: 2200, price: 1100 }, { len: 3000, price: 1450 }],
    installPerSection: 6500, deliveryMoscow: 5000, liftPerFloor: 0,
  },
}
export const DEFAULT_FINANCE = { marginPct: 40, taxPct: 12 }
export const unitPricesFor = (tier: Tier) => PRICES[tier]

// ── Хлысты: кусок → наименьший хлыст ≥ длины (или самый длинный, если кусок больше) ──
export function pickStock(pieceMm: number, stocks: Stock[]): Stock {
  const sorted = [...stocks].sort((a, b) => a.len - b.len)
  return sorted.find(s => s.len >= pieceMm) ?? sorted[sorted.length - 1]
}
export function barsCost(pieces: number[], stocks: Stock[]): { cost: number; bars: Record<number, number> } {
  const bars: Record<number, number> = {}
  let cost = 0
  for (const p of pieces) { const s = pickStock(p, stocks); if (!s) continue; bars[s.len] = (bars[s.len] ?? 0) + 1; cost += s.price }
  return { cost, bars }
}

// ── Расчёт цены ───────────────────────────────────────────────────
export type PriceLine = { key: string; label: string; qty: number; unit: string; unitPrice: number; total: number }
export type PriceResult = {
  glassCost: number
  hardwareLines: PriceLine[]
  hardwareCost: number
  profileCost: number
  profileBars: Record<number, number>
  tubeCost: number
  tubeBars: Record<number, number>
  materialsCost: number
  itemPrice: number              // Цена изделия = Себест / (1 − маржа − налог)
  sections: number
  installCost: number
  deliveryCost: number
  liftCost: number
  total: number
  marginPct: number
  taxPct: number
}

export type PriceOptions = { glassType?: string; finishId?: string; withDelivery?: boolean; floors?: number }

export function computePrice(
  q: Quantities,
  up: UnitPrices = PRICES.budget,
  finance = DEFAULT_FINANCE,
  opts: PriceOptions = {},
): PriceResult {
  const glassType = opts.glassType ?? 'clear'
  const finishId = opts.finishId ?? 'chrome'

  const glassRate = up.glassPerM2[glassType] ?? up.glassPerM2.clear ?? 0
  const glassCost = Math.round(q.glassM2 * glassRate)

  const hardwareLines: PriceLine[] = Object.entries(q.hardware).map(([model, qty]) => {
    const unitPrice = up.hardware[model]?.[finishId] ?? up.hardware[model]?.chrome ?? 0
    return { key: model, label: HARDWARE_LABEL[model] ?? model, qty, unit: 'шт', unitPrice, total: Math.round(qty * unitPrice) }
  })
  const hardwareCost = hardwareLines.reduce((s, l) => s + l.total, 0)

  const prof = barsCost(q.profilePieces, up.profileStock)
  const tube = barsCost(q.tubePieces, up.tubeStock)
  const materialsCost = glassCost + hardwareCost + prof.cost + tube.cost

  const fm = calcFinancialModel({ directCost: materialsCost, marginPercent: finance.marginPct, taxPercent: finance.taxPct })
  const itemPrice = fm?.finalPrice ?? 0

  const installCost = up.installPerSection * q.sections
  const deliveryCost = opts.withDelivery === false ? 0 : up.deliveryMoscow
  const liftCost = (opts.floors ?? 0) * up.liftPerFloor
  const total = itemPrice + installCost + deliveryCost + liftCost

  return {
    glassCost, hardwareLines, hardwareCost,
    profileCost: prof.cost, profileBars: prof.bars, tubeCost: tube.cost, tubeBars: tube.bars,
    materialsCost, itemPrice, sections: q.sections, installCost, deliveryCost, liftCost, total,
    marginPct: finance.marginPct, taxPct: finance.taxPct,
  }
}

// Клиенту — округлённая «от N ₽» (вниз до сотен).
export function clientPriceFrom(total: number): number {
  return Math.floor(total / 100) * 100
}

// Суммарный погонаж (для показа в спецификации).
export const totalMeters = (pieces: number[]) => round2(pieces.reduce((s, p) => s + p, 0) / 1000)
