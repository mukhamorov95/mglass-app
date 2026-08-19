import { calcFinancialModel } from '@/lib/pricing/financialModel'
import type { Assembly } from '@/components/configurator/scene/assembly'

// Расчёт цены изделия для визуализатора. Переиспользует движок «Быстрого расчёта»:
// себестоимость (стекло + фурнитура + профиль) → Цена = Себест / (1 − маржа − налог)
// через канонический calcFinancialModel; монтаж×секции + доставка + подъём — СВЕРХУ.
// Справочник цен — подгруппы фурнитуры (петли/ручки/трубы/профили/заглушки/уплотнители),
// у каждой позиции цена по цвету; профили/трубы — по ХЛЫСТАМ (2200/3000) тоже по цвету.
// Количества — из геометрии (cut-list). Владелец правит подгруппы/позиции в админке.

export type Tier = 'budget' | 'premium'

// ── Количества из геометрии (cut-list) ────────────────────────────
export type Quantities = {
  thickness: number
  sections: number                    // число полотен — монтаж (₽ × секции)
  glassM2: number                     // площадь стекла, м²
  profilePieces: number[]             // куски П-профиля Pr-002, мм (для хлыстов)
  tubePieces: number[]                // куски штанги 30×10, мм (для хлыстов)
  hardware: Record<string, number>    // штуки по ключу: {balge:3, sd210:1, roller:4, cap:6, seal:1, ...}
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
  // Заглушки на профиль: 2 на каждый кусок (верх/низ). Магнитный уплотнитель: на каждую распашную створку.
  if (profilePieces.length > 0) hardware.cap = (hardware.cap ?? 0) + profilePieces.length * 2
  if ((hardware.sd210 ?? 0) > 0) hardware.seal = (hardware.seal ?? 0) + hardware.sd210
  return { thickness, sections: assembly.glass.length, glassM2, profilePieces, tubePieces, hardware }
}

// ── Справочник цен (СЕБЕСТОИМОСТЬ) — подгруппы фурнитуры ────────────
export type PriceByColor = Record<string, number>           // finishId → ₽/шт
export type BarByColor = Record<string, Record<number, number>>  // finishId → {2200: ₽, 3000: ₽}

export type PieceItem = {
  key: string
  name: string
  prices: PriceByColor
  qtyMode: 'auto' | 'manual'      // auto — кол-во из геометрии по key; manual — фикс. кол-во
  fixedQty?: number
}
export type BarItem = {
  key: string                     // 'profile' | 'tube' — привязка к геометрии; иначе кол-ва нет
  name: string
  bars: BarByColor
}
export type HardwareGroup =
  | { id: string; title: string; kind: 'piece'; items: PieceItem[] }
  | { id: string; title: string; kind: 'bar'; items: BarItem[] }

export type UnitPrices = {
  glassPerM2: Record<string, number>   // тип стекла → ₽/м² (8 мм)
  groups: HardwareGroup[]              // подгруппы фурнитуры (петли/ручки/трубы/профили/заглушки/уплотнители)
  installPerSection: number            // монтаж за секцию
  deliveryMoscow: number               // доставка по Москве
  liftPerFloor: number                 // подъём за этаж
}

export const GLASS_TYPE_IDS = ['clear', 'crystal', 'bronze', 'graphite'] as const
export const FINISH_IDS = ['chrome', 'satin', 'black', 'gunmetal', 'bronze', 'gold', 'brgold', 'white', 'rose', 'brrose'] as const
export const STOCK_LENS = [2200, 3000] as const

export const HARDWARE_LABEL: Record<string, string> = {
  balge: 'Петля Balge-004', dessau: 'Петля Dessau-103', sd210: 'Ручка-скоба SD-210',
  kupe: 'Ручка-купе КУ-002', roller: 'Ролик РД-001', kp006: 'Крепёж КП-006 (стекло)',
  kp002: 'Крепёж КП-002 (стена)', kp001: 'Крепёж КП-001 (угол)', connector: 'Соединитель трубы',
  cap: 'Заглушка профиля', seal: 'Магнитный уплотнитель', profile: 'Профиль Pr-002', tube: 'Штанга 30×10',
}

// Наценка цвета к базовой цене фурнитуры (сид; в админке правится по позиции/цвету).
const COLOR_MULT: Record<string, number> = {
  chrome: 1, satin: 1.1, black: 1.25, gunmetal: 1.3, bronze: 1.3,
  gold: 1.45, brgold: 1.4, white: 1.15, rose: 1.5, brrose: 1.45,
}

const byColor = (base: number): PriceByColor => {
  const out: PriceByColor = {}
  for (const c of FINISH_IDS) out[c] = Math.round(base * (COLOR_MULT[c] ?? 1))
  return out
}
const barByColor = (b2200: number, b3000: number): BarByColor => {
  const out: BarByColor = {}
  for (const c of FINISH_IDS) out[c] = { 2200: Math.round(b2200 * (COLOR_MULT[c] ?? 1)), 3000: Math.round(b3000 * (COLOR_MULT[c] ?? 1)) }
  return out
}
const piece = (key: string, base: number): PieceItem =>
  ({ key, name: HARDWARE_LABEL[key] ?? key, prices: byColor(base), qtyMode: 'auto' })

// ── Дефолтные подгруппы (сид). Порядок = поток заполнения владельца ──
type SeedBar = { key: string; b2200: number; b3000: number }
function defaultGroups(hw: Record<string, number>, prof: SeedBar, tube: SeedBar): HardwareGroup[] {
  return [
    { id: 'hinges', title: 'Петли', kind: 'piece', items: [piece('balge', hw.balge), piece('dessau', hw.dessau)] },
    { id: 'handles', title: 'Ручки', kind: 'piece', items: [piece('sd210', hw.sd210), piece('kupe', hw.kupe)] },
    { id: 'rollers', title: 'Ролики', kind: 'piece', items: [piece('roller', hw.roller)] },
    { id: 'profiles', title: 'Профили', kind: 'bar', items: [{ key: 'profile', name: HARDWARE_LABEL.profile, bars: barByColor(prof.b2200, prof.b3000) }] },
    { id: 'tubes', title: 'Трубы / штанги', kind: 'bar', items: [{ key: 'tube', name: HARDWARE_LABEL.tube, bars: barByColor(tube.b2200, tube.b3000) }] },
    { id: 'mounts', title: 'Крепёж', kind: 'piece', items: [piece('kp006', hw.kp006), piece('kp002', hw.kp002), piece('kp001', hw.kp001), piece('connector', hw.connector)] },
    { id: 'caps', title: 'Заглушки', kind: 'piece', items: [piece('cap', hw.cap)] },
    { id: 'seals', title: 'Уплотнители', kind: 'piece', items: [piece('seal', hw.seal)] },
  ]
}

export function buildDefaultUnitPrices(tier: Tier): UnitPrices {
  if (tier === 'premium') return {
    glassPerM2: { clear: 3800, crystal: 4600, bronze: 5400, graphite: 5400 },
    groups: defaultGroups(
      { balge: 3600, dessau: 6900, sd210: 2200, kupe: 900, roller: 1100, kp006: 560, kp002: 480, kp001: 700, connector: 560, cap: 140, seal: 450 },
      { key: 'profile', b2200: 620, b3000: 820 }, { key: 'tube', b2200: 1100, b3000: 1450 },
    ),
    installPerSection: 6500, deliveryMoscow: 5000, liftPerFloor: 0,
  }
  return {
    glassPerM2: { clear: 3200, crystal: 3900, bronze: 4600, graphite: 4600 },
    groups: defaultGroups(
      { balge: 2500, dessau: 4000, sd210: 1500, kupe: 600, roller: 800, kp006: 400, kp002: 350, kp001: 500, connector: 400, cap: 100, seal: 300 },
      { key: 'profile', b2200: 520, b3000: 690 }, { key: 'tube', b2200: 900, b3000: 1180 },
    ),
    installPerSection: 6500, deliveryMoscow: 5000, liftPerFloor: 0,
  }
}

export const PRICES: Record<Tier, UnitPrices> = { budget: buildDefaultUnitPrices('budget'), premium: buildDefaultUnitPrices('premium') }
export const DEFAULT_FINANCE = { marginPct: 40, taxPct: 12 }
export const unitPricesFor = (tier: Tier) => PRICES[tier]

// ── Миграция сохранённых цен (старая плоская схема → подгруппы) без потерь ──
type LegacyPrices = {
  glassPerM2?: Record<string, number>
  hardware?: Record<string, Record<string, number>>
  profileStock?: { len: number; price: number }[]
  tubeStock?: { len: number; price: number }[]
  groups?: HardwareGroup[]
  installPerSection?: number; deliveryMoscow?: number; liftPerFloor?: number
}
export function migrateUnitPrices(raw: unknown, tier: Tier): UnitPrices {
  const def = buildDefaultUnitPrices(tier)
  if (!raw || typeof raw !== 'object') return def
  const r = raw as LegacyPrices
  const out: UnitPrices = {
    glassPerM2: { ...def.glassPerM2, ...(r.glassPerM2 ?? {}) },
    groups: def.groups,
    installPerSection: typeof r.installPerSection === 'number' ? r.installPerSection : def.installPerSection,
    deliveryMoscow: typeof r.deliveryMoscow === 'number' ? r.deliveryMoscow : def.deliveryMoscow,
    liftPerFloor: typeof r.liftPerFloor === 'number' ? r.liftPerFloor : def.liftPerFloor,
  }
  // Уже новая схема — доверяем сохранённым подгруппам.
  if (Array.isArray(r.groups)) { out.groups = r.groups; return out }
  // Старая плоская схема — переносим введённые цены на дефолтные подгруппы.
  const stockPrice = (arr: { len: number; price: number }[] | undefined, len: number) => arr?.find(s => s.len === len)?.price
  out.groups = def.groups.map(g => {
    if (g.kind === 'piece') return { ...g, items: g.items.map(it => r.hardware?.[it.key] ? { ...it, prices: { ...it.prices, ...r.hardware[it.key] } } : it) }
    return { ...g, items: g.items.map(it => {
      const src = it.key === 'profile' ? r.profileStock : it.key === 'tube' ? r.tubeStock : undefined
      const p2200 = stockPrice(src, 2200), p3000 = stockPrice(src, 3000)
      if (p2200 == null && p3000 == null) return it
      // старая цена без цвета → в «хром», остальные цвета масштабируем множителем
      const bars: BarByColor = {}
      for (const c of FINISH_IDS) bars[c] = {
        2200: p2200 != null ? Math.round(p2200 * (COLOR_MULT[c] ?? 1)) : it.bars[c]?.[2200] ?? 0,
        3000: p3000 != null ? Math.round(p3000 * (COLOR_MULT[c] ?? 1)) : it.bars[c]?.[3000] ?? 0,
      }
      return { ...it, bars }
    }) }
  })
  return out
}

// ── Хлысты: кусок → наименьший хлыст ≥ длины (или самый длинный, если кусок больше) ──
export type Stock = { len: number; price: number }
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
export type PriceLine = { key: string; label: string; qty: number; unit: string; unitPrice: number; total: number; bars?: Record<number, number> }
export type PriceGroup = { id: string; title: string; kind: 'piece' | 'bar'; lines: PriceLine[]; total: number }
export type PriceResult = {
  glassCost: number
  groupedLines: PriceGroup[]
  hardwareLines: PriceLine[]     // все piece-строки (обратная совместимость)
  hardwareCost: number           // сумма piece-строк (петли/ручки/ролики/крепёж/заглушки/уплотнители)
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

  const groupedLines: PriceGroup[] = []
  const hardwareLines: PriceLine[] = []
  let profileCost = 0, tubeCost = 0
  let profileBars: Record<number, number> = {}, tubeBars: Record<number, number> = {}

  for (const g of up.groups ?? []) {
    const lines: PriceLine[] = []
    if (g.kind === 'piece') {
      for (const it of g.items) {
        const qty = it.qtyMode === 'manual' ? (it.fixedQty ?? 0) : (q.hardware[it.key] ?? 0)
        if (qty <= 0) continue
        const unitPrice = it.prices[finishId] ?? it.prices.chrome ?? 0
        const line: PriceLine = { key: it.key, label: it.name, qty, unit: 'шт', unitPrice, total: Math.round(qty * unitPrice) }
        lines.push(line); hardwareLines.push(line)
      }
    } else {
      for (const it of g.items) {
        const pieces = it.key === 'profile' ? q.profilePieces : it.key === 'tube' ? q.tubePieces : []
        if (pieces.length === 0) continue
        const colorBars = it.bars[finishId] ?? it.bars.chrome ?? {}
        const stocks: Stock[] = STOCK_LENS.map(len => ({ len, price: colorBars[len] ?? 0 }))
        const { cost, bars } = barsCost(pieces, stocks)
        lines.push({ key: it.key, label: it.name, qty: totalMeters(pieces), unit: 'м.п.', unitPrice: 0, total: cost, bars })
        if (it.key === 'profile') { profileCost += cost; profileBars = bars }
        else if (it.key === 'tube') { tubeCost += cost; tubeBars = bars }
      }
    }
    if (lines.length) groupedLines.push({ id: g.id, title: g.title, kind: g.kind, lines, total: lines.reduce((s, l) => s + l.total, 0) })
  }

  const hardwareCost = hardwareLines.reduce((s, l) => s + l.total, 0)
  const materialsCost = glassCost + hardwareCost + profileCost + tubeCost

  const fm = calcFinancialModel({ directCost: materialsCost, marginPercent: finance.marginPct, taxPercent: finance.taxPct })
  const itemPrice = fm?.finalPrice ?? 0

  const installCost = up.installPerSection * q.sections
  const deliveryCost = opts.withDelivery === false ? 0 : up.deliveryMoscow
  const liftCost = (opts.floors ?? 0) * up.liftPerFloor
  const total = itemPrice + installCost + deliveryCost + liftCost

  return {
    glassCost, groupedLines, hardwareLines, hardwareCost,
    profileCost, profileBars, tubeCost, tubeBars,
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
