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
  hardware: Record<string, number>    // штуки по ключу геометрии: {balge:3, sd210:1, roller:4, cap:6, seal:1}
  roles: Record<string, number>       // штуки по РОЛИ подгруппы: {hinge, handle, roller, mount, cap, seal}
}

// Роль подгруппы → количество берётся из модели независимо от того, какую именно
// позицию (петлю/ручку) выбрали из справочника. Ролей столько, сколько нужно модели.
export const ROLE_LABEL: Record<string, string> = {
  hinge: 'петли', handle: 'ручки', roller: 'ролики', mount: 'крепёж', cap: 'заглушки', seal: 'уплотнитель',
}
function rolesFrom(hardware: Record<string, number>): Record<string, number> {
  const g = (k: string) => hardware[k] ?? 0
  return {
    hinge: g('balge') + g('dessau'),
    handle: g('sd210') + g('kupe'),
    roller: g('roller'),
    mount: g('kp006') + g('kp002') + g('kp001') + g('connector'),
    cap: g('cap'),
    seal: g('seal'),
  }
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
  return { thickness, sections: assembly.glass.length, glassM2, profilePieces, tubePieces, hardware, roles: rolesFrom(hardware) }
}

// ── Справочник цен (СЕБЕСТОИМОСТЬ) — подгруппы фурнитуры ────────────
export type PriceByColor = Record<string, number>           // finishId → ₽/шт
export type BarStock = { len: number; prices: PriceByColor } // хлыст: длина мм + цена по цвету

export type CatalogRef = { supplier: string; base: string; label?: string }  // связь со справочником поставщиков

export type PieceItem = {
  key: string
  name: string
  prices: PriceByColor
  qtyMode: 'auto' | 'manual'      // auto — кол-во из геометрии по key; manual — фикс. кол-во
  fixedQty?: number
  ref?: CatalogRef                // если цена взята из справочника — провенанс (на расчёт не влияет)
}
export type BarItem = {
  key: string                     // 'profile' | 'tube' — привязка к геометрии; иначе кол-ва нет
  name: string
  stocks: BarStock[]              // хлысты: длина у профиля/штанги РАЗНАЯ, редактируется в админке
}
export type HardwareGroup =
  | { id: string; title: string; kind: 'piece'; role?: string; items: PieceItem[] }
  | { id: string; title: string; kind: 'bar'; role?: string; items: BarItem[] }

export type UnitPrices = {
  glassPerM2: Record<string, number>   // тип стекла → ₽/м² (8 мм)
  groups: HardwareGroup[]              // подгруппы фурнитуры (петли/ручки/трубы/профили/заглушки/уплотнители)
  installPerSection: number            // монтаж за секцию
  deliveryMoscow: number               // доставка по Москве
  liftPerFloor: number                 // подъём за этаж
}

// Маппинг свободного текста цвета поставщика (Ветро: «Cp (хром полированный)», АВ24:
// «…/матовый», «…/черный») → finishId визуализатора. Порядок проверок важен
// (роза/золото/бронза/оружейка/белый/чёрный — раньше «матовый»/«хром»).
export function supplierColorToFinish(text: string): string | null {
  const t = (text || '').toLowerCase()
  const has = (...w: string[]) => w.some(x => t.includes(x))
  const brushed = has('браш', 'brush', 'brushed', 'br ', 'brgold', 'brrose', 'brbronze')
  if (has('роз', 'rose')) return brushed ? 'brrose' : 'rose'
  if (has('золот', 'gold', '/tp', ' tp')) return brushed ? 'brgold' : 'gold'
  if (has('бронз', 'bronze', '/bz')) return 'bronze'
  if (has('оружейн', 'gun metal', 'gunmetal', 'gun', '/gg')) return 'gunmetal'
  if (has('бел', 'white', '/mw')) return 'white'
  if (has('чёрн', 'черн', 'black', '/bl')) return 'black'
  if (has('матов', 'satin', 'sss', 'brushed nickel')) return 'satin'
  if (has('хром', 'chrome', ' cp', '/cp', 'pss', 'полированн', 'нерж')) return 'chrome'
  return null
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

// ── Дефолтные подгруппы: ПУСТЫЕ (позиции тянутся из справочника поставщиков).
// role → количество берётся из модели (геометрии). Порядок = поток заполнения.
function emptyGroups(): HardwareGroup[] {
  return [
    { id: 'hinges', title: 'Петли', kind: 'piece', role: 'hinge', items: [] },
    { id: 'handles', title: 'Ручки', kind: 'piece', role: 'handle', items: [] },
    { id: 'rollers', title: 'Ролики', kind: 'piece', role: 'roller', items: [] },
    { id: 'profiles', title: 'Профили', kind: 'bar', role: 'profile', items: [] },
    { id: 'tubes', title: 'Трубы / штанги', kind: 'bar', role: 'tube', items: [] },
    { id: 'mounts', title: 'Крепёж', kind: 'piece', role: 'mount', items: [] },
    { id: 'caps', title: 'Заглушки', kind: 'piece', role: 'cap', items: [] },
    { id: 'seals', title: 'Уплотнители', kind: 'piece', role: 'seal', items: [] },
  ]
}

export function buildDefaultUnitPrices(tier: Tier): UnitPrices {
  const glassPerM2 = tier === 'premium'
    ? { clear: 3800, crystal: 4600, bronze: 5400, graphite: 5400 }
    : { clear: 3200, crystal: 3900, bronze: 4600, graphite: 4600 }
  return { glassPerM2, groups: emptyGroups(), installPerSection: 6500, deliveryMoscow: 5000, liftPerFloor: 0 }
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
  // Уже новая схема — доверяем сохранённым подгруппам, но (1) нормализуем bar-позиции
  // (ранняя версия хранила bars:{цвет→{2200,3000}} — приводим к stocks[]); (2) бэкфиллим
  // role по id (в ранней версии подгруппы были без роли).
  if (Array.isArray(r.groups)) {
    const defRole = new Map(def.groups.map(g => [g.id, g.role]))
    out.groups = r.groups.map(g => {
      const role = g.role ?? defRole.get(g.id)
      return g.kind === 'bar'
        ? { ...g, role, items: (g.items as unknown[]).map(normalizeBarItem) }
        : { ...g, role }
    })
    return out
  }
  // Старая плоская схема — переносим введённые цены на дефолтные подгруппы.
  const stockScaled = (base: number): PriceByColor => byColorScaled(base)
  out.groups = def.groups.map(g => {
    if (g.kind === 'piece') return { ...g, items: g.items.map(it => r.hardware?.[it.key] ? { ...it, prices: { ...it.prices, ...r.hardware[it.key] } } : it) }
    return { ...g, items: g.items.map(it => {
      const src = it.key === 'profile' ? r.profileStock : it.key === 'tube' ? r.tubeStock : undefined
      if (!src?.length) return it
      // старая цена без цвета → в «хром» как есть, остальные цвета масштабируем множителем
      return { ...it, stocks: src.map(s => ({ len: s.len, prices: stockScaled(s.price) })) }
    }) }
  })
  return out
}

// «хром» = базовая цена как есть, остальные цвета — по множителю.
function byColorScaled(base: number): PriceByColor {
  const out: PriceByColor = {}
  for (const c of FINISH_IDS) out[c] = Math.round(base * (COLOR_MULT[c] ?? 1))
  return out
}

// Приводит bar-позицию к схеме stocks[] (терпит старое поле bars и пустоту).
function normalizeBarItem(raw: unknown): BarItem {
  const it = (raw ?? {}) as { key?: string; name?: string; stocks?: BarStock[]; bars?: Record<string, Record<number, number>> }
  const key = it.key ?? 'bar', name = it.name ?? 'Хлыст'
  if (Array.isArray(it.stocks)) return { key, name, stocks: it.stocks }
  const bars = it.bars ?? {}
  const lens = new Set<number>()
  for (const c of Object.keys(bars)) for (const l of Object.keys(bars[c] ?? {})) lens.add(Number(l))
  if (lens.size === 0) { lens.add(2200); lens.add(3000) }
  const stocks = [...lens].sort((a, b) => a - b).map(len => {
    const prices: PriceByColor = {}
    for (const c of FINISH_IDS) prices[c] = bars[c]?.[len] ?? 0
    return { len, prices }
  })
  return { key, name, stocks }
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
      // Кол-во auto-позиции = сколько нужно модели по РОЛИ подгруппы (петли/ручки/…).
      // Первая auto-позиция получает это кол-во; остальные auto — 0 (запасные варианты).
      const roleQty = g.role ? (q.roles[g.role] ?? 0) : 0
      let autoUsed = false
      for (const it of g.items) {
        let qty: number
        if (it.qtyMode === 'manual') qty = it.fixedQty ?? 0
        else { qty = autoUsed ? 0 : roleQty; autoUsed = true }
        if (qty <= 0) continue
        const unitPrice = it.prices[finishId] ?? it.prices.chrome ?? 0
        const line: PriceLine = { key: it.key, label: it.name, qty, unit: 'шт', unitPrice, total: Math.round(qty * unitPrice) }
        lines.push(line); hardwareLines.push(line)
      }
    } else {
      for (const it of g.items) {
        const pieces = it.key === 'profile' ? q.profilePieces : it.key === 'tube' ? q.tubePieces : []
        if (pieces.length === 0) continue
        const stocks: Stock[] = (it.stocks ?? [])
          .map(s => ({ len: s.len, price: s.prices[finishId] ?? s.prices.chrome ?? 0 }))
          .filter(s => s.len > 0)
        if (stocks.length === 0) continue
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
