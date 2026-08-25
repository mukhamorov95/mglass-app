import { calcFinancialModel } from '@/lib/pricing/financialModel'
import { buildFromModel, type Assembly } from '@/components/configurator/scene/assembly'
import type { MModel } from '@/lib/configurator/arrangement'
import { inferShape } from '@/lib/configurator/hardwareShapes'
import type { PriceByColor, BarStock, CatalogRef, Tier } from '@/lib/configurator/pricing'

// Прайс ПО МОДЕЛЯМ. Два уровня, чтобы цену позиции вбивать один раз:
//   Библиотека (на тариф) — позиция: наименование, роль, цены по цветам, ссылка на справочник.
//   Комплект модели (на модель × тариф) — слоты ролей со ссылками на позиции: порядок, ★ по
//   умолчанию, правило количества. Удалил роль из модели — библиотека не тронута.
// Количество каждой роли даёт ГЕОМЕТРИЯ (buildFromModel уже знает, что kp002 — к стене,
// kp006 — к стеклу, и сколько петель нужно по ширине/высоте двери).

// ── Роли ──────────────────────────────────────────────────────────
// Правило: позиции, работающие ОДНОВРЕМЕННО — разные роли (крепёж к стене + к стеклу + угловой).
// Позиции НА ВЫБОР — одна роль с несколькими записями (петля Balge или FDP-115).
export const ROLES = [
  'hinge', 'handle', 'handle-slide', 'roller',
  'mount-wall', 'mount-glass', 'mount-corner', 'mount-diag45', 'mount-stabilizer', 'connector',
  'cap', 'cap-end', 'seal-magnet', 'seal-bottom', 'seal-hinge',
  'profile', 'profile-wall', 'profile-floor', 'profile-top', 'profile-vertical',
  'tube', 'tube-diag45', 'tube-stabilizer',
] as const
export type RoleId = typeof ROLES[number]

export type RoleMeta = { label: string; kind: 'piece' | 'bar'; hint: string }
export const ROLE_META: Record<RoleId, RoleMeta> = {
  'hinge':        { label: 'Петли',                 kind: 'piece', hint: '2 или 3 — по ширине и высоте двери' },
  'handle':       { label: 'Ручка распашной',       kind: 'piece', hint: 'скоба / кноб — на дверь' },
  'handle-slide': { label: 'Ручка раздвижной',      kind: 'piece', hint: 'купе / врезная — на створку' },
  'roller':       { label: 'Ролики',                kind: 'piece', hint: 'каретки раздвижной створки' },
  'mount-wall':   { label: 'Крепление к стене',     kind: 'piece', hint: 'труба 30×10 → стена' },
  'mount-glass':  { label: 'Крепление к стеклу',    kind: 'piece', hint: 'держатель стекла на трубе' },
  'mount-corner': { label: 'Крепление угловое',     kind: 'piece', hint: 'Г-образное, труба → стекло' },
  'mount-diag45': { label: 'Крепление 45°',         kind: 'piece', hint: 'штанга «люкс» под 45° — два крепления' },
  'mount-stabilizer': { label: 'Крепление стабилизатора', kind: 'piece', hint: 'стабилизационная штанга' },
  'connector':    { label: 'Соединитель трубы',     kind: 'piece', hint: 'стык труб под углом' },
  'cap':          { label: 'Заглушка профиля',      kind: 'bar',   hint: 'погонная, по длине каждого куска профиля' },
  'cap-end':      { label: 'Заглушка торцевая',     kind: 'piece', hint: 'на срез профиля — 2 на кусок' },
  'seal-magnet':  { label: 'Уплотнитель магнитный', kind: 'bar',   hint: 'притвор двери — по высоте двери' },
  'seal-bottom':  { label: 'Уплотнитель нижний',    kind: 'bar',   hint: 'низ створки — по ширине двери' },
  'seal-hinge':   { label: 'Уплотнитель петлевой',  kind: 'bar',   hint: 'стык со стационаром — по высоте двери' },
  'profile':      { label: 'Профиль',               kind: 'bar',   hint: 'по стене и по полу — хлысты' },
  'profile-wall': { label: 'Профиль по стене',      kind: 'bar',   hint: 'вертикаль у стены' },
  'profile-floor':{ label: 'Профиль по полу',       kind: 'bar',   hint: 'нижняя обвязка' },
  'profile-top':  { label: 'Профиль верхний',       kind: 'bar',   hint: 'верх — потолочный вариант и обвязка по периметру' },
  'profile-vertical': { label: 'Профиль вертикальный', kind: 'bar', hint: 'свободная вертикаль — только по периметру' },
  'tube':         { label: 'Труба / штанга',        kind: 'bar',   hint: '30×10 перпендикулярно — длина от глубины поддона' },
  'tube-diag45':  { label: 'Штанга 45°',            kind: 'bar',   hint: 'вариант «люкс»' },
  'tube-stabilizer': { label: 'Стабилизационная штанга', kind: 'bar', hint: 'распорка' },
}
export const isRole = (v: string): v is RoleId => (ROLES as readonly string[]).includes(v)

// Точка установки из геометрии → роль. Геометрия называет фурнитуру артикулами,
// прайс мыслит ролями; эта таблица — единственный переводчик между контурами.
const PLACEMENT_ROLE: Record<string, RoleId> = {
  balge: 'hinge', dessau: 'hinge', sd210: 'handle', kupe: 'handle-slide', roller: 'roller',
  kp002: 'mount-wall', kp006: 'mount-glass', kp001: 'mount-corner', connector: 'connector', cap: 'cap',
}

// Геометрия может пометить узел явно (`spec`) — тогда роль берётся оттуда: у вариантов
// одной модели (труба 90° / 45° / стабилизатор / в потолок) артикулы разные, и по общему
// kind их не развести. Нет spec — работает старый фолбэк по kind/model.
const specRole = (spec: string | undefined, fallback: RoleId): RoleId =>
  spec && isRole(spec) ? spec : fallback

// Название позиции справочника → роль (подсказка при вставке; правится вручную).
export function inferRole(text: string): RoleId | null {
  const t = (text || '').toLowerCase()
  if (/уплотнител|шлегель|профиль.?уплотн/.test(t)) {
    if (/магнит/.test(t)) return 'seal-magnet'
    if (/нижн|низ |порог/.test(t)) return 'seal-bottom'
    return 'seal-hinge'
  }
  if (/заглушк|колпач/.test(t)) return /торцев|торец|заглушка на срез/.test(t) ? 'cap-end' : 'cap'
  if (/ролик|каретк/.test(t)) return 'roller'
  if (/соедин|коннектор/.test(t)) return 'connector'
  if (/петл|навес|hinge/.test(t)) return 'hinge'
  // «держатель стекла» и «крепление трубы к стеклу» — РАЗНЫЕ узлы: первый держит
  // полотно на трубе, второй пристыковывает трубу к перпендикулярному стеклу.
  if (/держател.*стекл/.test(t)) return 'mount-glass'
  if (/г-?образн|углов/.test(t)) return 'mount-corner'
  if (/(крепл|крепёж|крепеж).*труб.*стекл/.test(t)) return 'mount-corner'
  if (/(держател|крепл|крепёж|крепеж).*(стекл)/.test(t)) return 'mount-glass'
  if (/(держател|крепл|крепёж|крепеж).*(стен)/.test(t)) return 'mount-wall'
  if (/купе|врезн|утоплен/.test(t)) return 'handle-slide'
  if (/ручк|скоб|кноб|поручень/.test(t)) return 'handle'
  if (/труб|штанг/.test(t)) return 'tube'
  if (/профил/.test(t)) return 'profile'
  return null
}

// Длина хлыста из названия поставщика: «…прозрачный 2.2 м», «…, 1 м, для п-образного…».
// Уплотнители и заглушка продаются погонно — считать их штуками значит врать себе в цене.
export function parseLengthMm(text: string): number {
  const m = (text || '').replace(',', '.').match(/(\d+(?:\.\d+)?)\s*м(?![а-яёa-z])/i)
  return m ? Math.round(parseFloat(m[1]) * 1000) : 0
}

// ── Библиотека позиций (на тариф) ─────────────────────────────────
export type LibraryItem = {
  id: string
  name: string
  role: RoleId
  prices?: PriceByColor      // piece: ₽/шт по цвету
  stocks?: BarStock[]        // bar: хлысты (длина + цена по цвету)
  ref?: CatalogRef           // провенанс: строка справочника поставщика
  shape?: string             // форма для 3D (переопределяет авто по названию)
}
export type Library = { items: LibraryItem[] }

// ── Комплект модели (на модель × тариф) ───────────────────────────
export type QtyRule =
  | { mode: 'role' }                                        // сколько нужно модели по роли слота
  | { mode: 'fixed'; n: number }
  | { mode: 'per'; of: RoleId; k: number }                  // k × количество другой роли
  | { mode: 'client'; options: number[]; def: number }      // выбор клиента (петель 2 или 3)
export type KitEntry = { itemId: string; qty: QtyRule; primary?: boolean }
export type KitSlot = {
  role: RoleId
  title?: string
  select: 'one' | 'all'      // 'one' — клиент выбирает вариант; 'all' — работают все записи
  entries: KitEntry[]
}
export type ModelKit = { slots: KitSlot[] }

export const DEFAULT_QTY: QtyRule = { mode: 'role' }
export const emptyKit = (): ModelKit => ({ slots: [] })
export const emptyLibrary = (): Library => ({ items: [] })

// ── Количества из геометрии ───────────────────────────────────────
export type KitQuantities = {
  thickness: number
  sections: number
  glassM2: number
  profilePieces: number[]        // куски профиля, мм (сводно — для раскроя и совместимости)
  tubePieces: number[]
  barPieces: Record<string, number[]>   // куски по КАЖДОЙ bar-роли
  roleQty: Record<RoleId, number>
  swingDoors: number
  slideDoors: number
}

const round2 = (n: number) => Math.round(n * 100) / 100
const mm = (m: number) => Math.round(m * 1000)

function doorCounts(model?: MModel): { swing: number; slide: number } {
  if (!model) return { swing: 0, slide: 0 }
  let swing = 0, slide = 0
  for (const r of model.runs) for (const s of r.segs) {
    if (s.t === 'door') swing++
    else if (s.t === 'slide') slide++
  }
  return { swing, slide }
}

export function computeKitQuantities(assembly: Assembly, thickness: number, model?: MModel): KitQuantities {
  const glassM2 = round2(assembly.glass.reduce((s, g) => s + g.size[0] * g.size[1], 0))

  // Кусок металла → своя bar-роль. Стойка меряется по высоте, остальное по длине.
  const barPieces: Record<string, number[]> = {}
  for (const m of assembly.metal) {
    const spec = (m as { spec?: string }).spec
    const fallback: RoleId = m.kind === 'rail' ? 'tube' : 'profile'
    const role = specRole(spec, fallback)
    const len = mm(m.kind === 'post' ? m.size[1] : m.size[0])
    if (len <= 0) continue
    ;(barPieces[role] ??= []).push(len)
  }
  const profilePieces = ROLES.filter(r => r.startsWith('profile')).flatMap(r => barPieces[r] ?? [])
  const tubePieces = ROLES.filter(r => r.startsWith('tube')).flatMap(r => barPieces[r] ?? [])

  const roleQty = Object.fromEntries(ROLES.map(r => [r, 0])) as Record<RoleId, number>
  for (const h of assembly.hardware) {
    const spec = (h as { spec?: string }).spec
    const fallback = PLACEMENT_ROLE[h.model]
    if (!spec && !fallback) continue
    roleQty[specRole(spec, fallback)] += 1
  }
  // Погонные позиции меряются длиной, а не штуками: заглушка идёт по каждому куску
  // профиля, уплотнители — по двери (вертикальные по высоте, нижний по ширине).
  const doors = assembly.glass.filter(g => g.role === 'door')
  const { swing, slide } = doorCounts(model)
  const swingDoors = swing || (roleQty.hinge > 0 ? 1 : 0)
  const slideDoors = slide || (roleQty.roller > 0 ? 1 : 0)
  if (profilePieces.length) barPieces.cap = [...profilePieces]
  if (doors.length) {
    const vertical = doors.slice(0, swingDoors).map(d => mm(d.size[1]))
    if (vertical.length) { barPieces['seal-magnet'] = vertical; barPieces['seal-hinge'] = [...vertical] }
    barPieces['seal-bottom'] = doors.map(d => mm(d.size[0]))
  }
  roleQty['cap-end'] = profilePieces.length * 2
  for (const r of ROLES) if (ROLE_META[r].kind === 'bar') roleQty[r] = (barPieces[r] ?? []).length

  return { thickness, sections: assembly.glass.length, glassM2, profilePieces, tubePieces, barPieces, roleQty, swingDoors, slideDoors }
}

// ── Раскрой хлыстов ───────────────────────────────────────────────
// Куски режутся из хлыстов: из трёхметрового можно выкроить стойку и кусок вниз.
// Ищем набор хлыстов минимальной СТОИМОСТИ (не минимального метража — хлысты разной цены).
export type Stock = { len: number; price: number }
export type BarPlan = { len: number; price: number; pieces: number[]; rest: number }
export type BarResult = { cost: number; plan: BarPlan[]; bars: Record<number, number>; oversize: number[] }

// Погонные материалы (заглушка, уплотнитель) можно набрать из нескольких хлыстов —
// стык не виден и не мешает. Жёсткие профиль и труба стыковать нельзя: если кусок
// длиннее любого хлыста, это ошибка комплектации, а не повод молча посчитать один.
const SPLICEABLE: RoleId[] = ['cap', 'seal-magnet', 'seal-bottom', 'seal-hinge']
export const canSplice = (role: RoleId) => SPLICEABLE.includes(role)

// Кусок длиннее самого длинного хлыста → набираем несколькими: пока остаток не
// перекрыт, берём самый выгодный по цене за миллиметр, последним — самый дешёвый
// из тех, что закрывают остаток.
function spliceCover(piece: number, stocks: Stock[], kerf: number): Stock[] {
  const out: Stock[] = []
  let rest = piece
  let guard = 0
  while (rest > 0 && guard++ < 100) {
    const fits = stocks.filter(s => s.len >= rest)
    const s = fits.length
      ? fits.reduce((a, b) => (b.price < a.price ? b : a))
      : stocks.reduce((a, b) => (b.price / b.len < a.price / a.len ? b : a))
    out.push(s)
    rest -= s.len - (rest > s.len ? kerf : 0)
  }
  return out
}

function packWith(pieces: number[], stocks: Stock[], kerf: number, pick: (need: number) => Stock | undefined): BarPlan[] | null {
  const plan: BarPlan[] = []
  for (const p of [...pieces].sort((a, b) => b - a)) {
    // 1) кладём в уже открытый хлыст (First-Fit Decreasing) — так остаток идёт в дело
    const open = plan.find(b => b.rest >= p + (b.pieces.length ? kerf : 0))
    if (open) {
      open.rest -= p + (open.pieces.length ? kerf : 0)
      open.pieces.push(p)
      continue
    }
    const s = pick(p)
    if (!s) return null                                   // кусок длиннее любого хлыста
    plan.push({ len: s.len, price: s.price, pieces: [p], rest: s.len - p })
  }
  return plan
}

export function planBars(pieces: number[], stocks: Stock[], kerf = 0, splice = false): BarResult {
  const empty: BarResult = { cost: 0, plan: [], bars: {}, oversize: [] }
  const usable = stocks.filter(s => s.len > 0 && s.price > 0).sort((a, b) => a.len - b.len)
  if (pieces.length === 0 || usable.length === 0) return empty

  const longest = usable[usable.length - 1].len
  const oversize = pieces.filter(p => p > longest)
  if (oversize.length > 0 && splice) {
    // Длинные куски набираем стыковкой, короткие — обычным раскроем.
    const spliced = oversize.flatMap(p => spliceCover(p, usable, kerf))
    const rest = planBars(pieces.filter(p => p <= longest), usable, kerf)
    const plan = [...spliced.map(s => ({ len: s.len, price: s.price, pieces: [s.len], rest: 0 })), ...rest.plan]
    const bars: Record<number, number> = {}
    for (const b of plan) bars[b.len] = (bars[b.len] ?? 0) + 1
    return { cost: cost(plan), plan, bars, oversize: [] }
  }

  const candidates: BarPlan[][] = []
  // (а) только один тип хлыста — по каждому типу отдельно
  for (const s of usable) {
    const p = packWith(pieces, usable, kerf, need => (s.len >= need ? s : undefined))
    if (p) candidates.push(p)
  }
  // (б) под каждый кусок — самый дешёвый хлыст, куда он влезает
  const cheapestFit = packWith(pieces, usable, kerf, need => [...usable].filter(s => s.len >= need).sort((a, b) => a.price - b.price)[0])
  if (cheapestFit) candidates.push(cheapestFit)
  // (в) под каждый кусок — самый выгодный по цене за миллиметр
  const bestRate = packWith(pieces, usable, kerf, need => [...usable].filter(s => s.len >= need).sort((a, b) => a.price / a.len - b.price / b.len)[0])
  if (bestRate) candidates.push(bestRate)
  // (г) кусок длиннее любого хлыста — считаем по самому длинному, чтобы не потерять деньги
  if (candidates.length === 0) {
    const longest = usable[usable.length - 1]
    const plan = pieces.map(p => ({ len: longest.len, price: longest.price, pieces: [p], rest: 0 }))
    candidates.push(plan)
  }

  const best = candidates.reduce((a, b) => (cost(b) < cost(a) ? b : a))
  const bars: Record<number, number> = {}
  for (const b of best) bars[b.len] = (bars[b.len] ?? 0) + 1
  return { cost: cost(best), plan: best, bars, oversize }
}
const cost = (plan: BarPlan[]) => plan.reduce((s, b) => s + b.price, 0)

// ── Расчёт по комплекту модели ────────────────────────────────────
export type KitLine = {
  role: RoleId
  itemId: string
  label: string
  qty: number
  unit: 'шт' | 'хлыст'
  unitPrice: number
  total: number
  plan?: BarPlan[]
  chosen?: boolean          // выбранный клиентом вариант в слоте 'one'
}
export type KitPriceResult = {
  glassCost: number
  lines: KitLine[]
  hardwareCost: number
  materialsCost: number
  itemPrice: number
  sections: number
  installCost: number
  deliveryCost: number
  liftCost: number
  total: number
  marginPct: number
  taxPct: number
  missing: { role: RoleId; label: string; reason: 'нет позиции' | 'нет цены' | 'кусок длиннее хлыста' }[]
  complete: boolean
}

export type KitRates = {
  glassPerM2: Record<string, number>
  installPerSection: number
  deliveryMoscow: number
  liftPerFloor: number
  kerf?: number             // ширина пропила, мм
}
export type KitOptions = {
  glassType?: string
  finishId?: string
  withDelivery?: boolean
  floors?: number
  choice?: Partial<Record<RoleId, string>>   // выбранная клиентом позиция в слоте
  qtyChoice?: Partial<Record<RoleId, number>> // выбранное клиентом количество (петли 2/3)
}

const priceOf = (it: LibraryItem, finishId: string) => it.prices?.[finishId] ?? it.prices?.chrome ?? 0

export function resolveQty(rule: QtyRule, role: RoleId, q: KitQuantities, opts: KitOptions): number {
  switch (rule.mode) {
    case 'fixed': return Math.max(0, rule.n)
    case 'per': return Math.max(0, Math.round(rule.k * (q.roleQty[rule.of] ?? 0)))
    case 'client': {
      const want = opts.qtyChoice?.[role]
      return want != null && rule.options.includes(want) ? want : rule.def
    }
    default: return q.roleQty[role] ?? 0
  }
}

export function computeKitPrice(
  q: KitQuantities,
  lib: Library,
  kit: ModelKit,
  rates: KitRates,
  finance: { marginPct: number; taxPct: number },
  opts: KitOptions = {},
): KitPriceResult {
  const glassType = opts.glassType ?? 'clear'
  const finishId = opts.finishId ?? 'chrome'
  const byId = new Map(lib.items.map(i => [i.id, i]))

  const glassRate = rates.glassPerM2[glassType] ?? rates.glassPerM2.clear ?? 0
  const glassCost = Math.round(q.glassM2 * glassRate)

  const lines: KitLine[] = []
  const missing: KitPriceResult['missing'] = []

  for (const slot of kit.slots) {
    const meta = ROLE_META[slot.role]
    const need = q.roleQty[slot.role] ?? 0
    const entries = slot.entries.filter(e => byId.has(e.itemId))
    // Слот не нужен этой модели (геометрия не даёт количества) — молча пропускаем.
    if (need <= 0 && !slot.entries.some(e => e.qty.mode === 'fixed')) continue
    if (entries.length === 0) { missing.push({ role: slot.role, label: meta.label, reason: 'нет позиции' }); continue }

    // 'one' — считается ровно одна запись: выбор клиента → ★ по умолчанию → первая по порядку.
    const active = slot.select === 'one'
      ? [entries.find(e => e.itemId === opts.choice?.[slot.role]) ?? entries.find(e => e.primary) ?? entries[0]]
      : entries

    let paid = false
    for (const e of active) {
      const it = byId.get(e.itemId)!
      const qty = resolveQty(e.qty, slot.role, q, opts)
      if (qty <= 0) continue
      if (meta.kind === 'bar') {
        const pieces = q.barPieces[slot.role] ?? []
        const stocks: Stock[] = (it.stocks ?? [])
          .map(s => ({ len: s.len, price: s.prices?.[finishId] ?? s.prices?.chrome ?? 0 }))
          .filter(s => s.len > 0 && s.price > 0)
        if (stocks.length === 0 || pieces.length === 0) continue
        const r = planBars(pieces, stocks, rates.kerf ?? 0, canSplice(slot.role))
        if (r.cost <= 0) continue
        paid = true
        if (r.oversize.length) missing.push({ role: slot.role, label: meta.label, reason: 'кусок длиннее хлыста' })
        lines.push({
          role: slot.role, itemId: it.id, label: it.name, qty: r.plan.length, unit: 'хлыст',
          unitPrice: Math.round(r.cost / Math.max(1, r.plan.length)), total: r.cost, plan: r.plan,
          chosen: slot.select === 'one',
        })
      } else {
        const unitPrice = priceOf(it, finishId)
        if (unitPrice <= 0) continue
        paid = true
        lines.push({
          role: slot.role, itemId: it.id, label: it.name, qty, unit: 'шт',
          unitPrice, total: Math.round(qty * unitPrice), chosen: slot.select === 'one',
        })
      }
    }
    if (!paid) missing.push({ role: slot.role, label: meta.label, reason: 'нет цены' })
  }

  // Роль нужна модели, а слота под неё в комплекте вообще нет — это дыра, а не «удалил намеренно»:
  // молчать нельзя, иначе изделие уедет клиенту дешевле себестоимости.
  for (const role of ROLES) {
    if ((q.roleQty[role] ?? 0) <= 0) continue
    if (kit.slots.some(s => s.role === role)) continue
    missing.push({ role, label: ROLE_META[role].label, reason: 'нет позиции' })
  }

  const hardwareCost = lines.reduce((s, l) => s + l.total, 0)
  const materialsCost = glassCost + hardwareCost
  const fm = calcFinancialModel({ directCost: materialsCost, marginPercent: finance.marginPct, taxPercent: finance.taxPct })
  const itemPrice = fm?.finalPrice ?? 0
  const installCost = rates.installPerSection * q.sections
  const deliveryCost = opts.withDelivery === false ? 0 : rates.deliveryMoscow
  const liftCost = (opts.floors ?? 0) * rates.liftPerFloor

  return {
    glassCost, lines, hardwareCost, materialsCost, itemPrice,
    sections: q.sections, installCost, deliveryCost, liftCost,
    total: itemPrice + installCost + deliveryCost + liftCost,
    marginPct: finance.marginPct, taxPct: finance.taxPct,
    missing, complete: missing.length === 0,
  }
}

// ── Что показать клиенту как ВЫБОР (без себестоимости) ────────────
export const inferShapeOf = (it: LibraryItem) => it.shape || inferShape(it.name)

export type KitChoiceOption = { itemId: string; name: string; shape: string; primary: boolean }
export type KitChoices = {
  variants: { role: RoleId; label: string; options: KitChoiceOption[] }[]
  quantities: { role: RoleId; label: string; options: number[]; def: number }[]
}
export function kitChoices(lib: Library, kit: ModelKit, q: KitQuantities): KitChoices {
  const byId = new Map(lib.items.map(i => [i.id, i]))
  const variants: KitChoices['variants'] = []
  const quantities: KitChoices['quantities'] = []
  for (const slot of kit.slots) {
    if ((q.roleQty[slot.role] ?? 0) <= 0) continue
    const opts = slot.entries
      .map(e => { const it = byId.get(e.itemId); return it ? { itemId: it.id, name: it.name, shape: it.shape || inferShape(it.name), primary: !!e.primary } : null })
      .filter((o): o is KitChoiceOption => o !== null)
    if (slot.select === 'one' && opts.length > 1) {
      // ★ по умолчанию идёт первой в списке у клиента, дальше — заданный владельцем порядок
      const ordered = [...opts].sort((a, b) => Number(b.primary) - Number(a.primary))
      variants.push({ role: slot.role, label: slot.title || ROLE_META[slot.role].label, options: ordered })
    }
    const client = slot.entries.find(e => e.qty.mode === 'client')
    if (client && client.qty.mode === 'client') {
      quantities.push({ role: slot.role, label: slot.title || ROLE_META[slot.role].label, options: client.qty.options, def: client.qty.def })
    }
  }
  return { variants, quantities }
}

export type KitStore = { library: Library; kits: Record<string, ModelKit>; rates: KitRates }
export const kitKey = (tier: Tier, code: string) => `${tier}:${code}`

// ── Стартовое заполнение ──────────────────────────────────────────
// Роли, которые модель реально требует: строим её в средних размерах и смотрим,
// что даёт геометрия. Это же определяет набор слотов в новом комплекте.
export function requiredRoles(model: MModel): RoleId[] {
  const c = model.constraints
  const mid = ([a, b]: [number, number]) => Math.round((a + b) / 200) * 100
  const dims = {
    width: mid(c.width), height: Math.min(2000, c.height[1]),
    width2: c.needsWidth2 && c.width2 ? mid(c.width2) : undefined,
    doorWidth: c.doorWidth ? mid(c.doorWidth) : undefined,
  }
  const q = computeKitQuantities(buildFromModel(model, dims, model.thickness[0] ?? 8), model.thickness[0] ?? 8, model)
  return ROLES.filter(r => (q.roleQty[r] ?? 0) > 0)
}

// Комплект по умолчанию: слот на каждую требуемую роль, внутри — позиции библиотеки
// с этой ролью (первая ★). Роль без позиций даёт пустой слот — владелец увидит дыру.
export function defaultKitFor(model: MModel, lib: Library): ModelKit {
  return {
    slots: requiredRoles(model).map(role => ({
      role,
      select: 'one' as const,
      entries: lib.items.filter(i => i.role === role).map((i, idx) => ({
        itemId: i.id, qty: DEFAULT_QTY, ...(idx === 0 ? { primary: true } : {}),
      })),
    })),
  }
}

// Перенос старой схемы (общие подгруппы на тариф) в библиотеку позиций.
// Роль берём от подгруппы, уточняем по названию: старый общий «крепёж» распадается
// на крепление к стене / к стеклу / угловое, «уплотнители» — на магнитный/нижний/петлевой.
const LEGACY_GROUP_ROLE: Record<string, RoleId> = {
  hinges: 'hinge', handles: 'handle', rollers: 'roller', profiles: 'profile',
  tubes: 'tube', mounts: 'mount-wall', caps: 'cap', seals: 'seal-hinge',
}
export function libraryFromUnitPrices(up: UnitPricesLike): Library {
  const items: LibraryItem[] = []
  for (const g of up.groups ?? []) {
    const fallback = LEGACY_GROUP_ROLE[g.id] ?? (g.kind === 'bar' ? 'profile' : 'cap')
    for (const it of g.items ?? []) {
      const guessed = inferRole(it.name)
      // подсказка по названию побеждает только внутри того же вида (piece/bar)
      const role = guessed && ROLE_META[guessed].kind === ROLE_META[fallback].kind ? guessed : fallback
      const piece = it as { key: string; name: string; prices?: PriceByColor; ref?: CatalogRef; shape?: string }
      const bar = it as { key: string; name: string; stocks?: BarStock[] }
      // Позиция была штучной, а роль оказалась погонной (уплотнители, заглушка профиля):
      // цена превращается в хлыст, длина — из полного названия поставщика.
      const toBar = ROLE_META[role].kind === 'bar' && g.kind === 'piece'
      const len = toBar ? (parseLengthMm(piece.ref?.label ?? '') || parseLengthMm(it.name)) : 0
      items.push({
        id: piece.key, name: it.name, role,
        ...(g.kind === 'bar' ? { stocks: bar.stocks ?? [] }
          : toBar ? { stocks: [{ len, prices: piece.prices ?? {} }] }
          : { prices: piece.prices ?? {} }),
        ...(piece.ref ? { ref: piece.ref } : {}),
        ...(piece.shape ? { shape: piece.shape } : {}),
      })
    }
  }
  return { items }
}
type UnitPricesLike = {
  groups?: { id: string; kind: 'piece' | 'bar'; items?: { key: string; name: string }[] }[]
}
