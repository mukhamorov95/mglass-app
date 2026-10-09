import { calcItem, effectiveItemTotal, type B2BOrderItem } from '@/lib/b2bCalculator'
import type { B2BMaterial } from '@/lib/types'
import type { B2BRates } from '@/lib/b2b/rates'
import type { FINISH_IDS } from '@/lib/configurator/pricing'
import { articleBase, isDefectRow, rowCost, rowFinish, splitAv24Article, type ColorAxis, type SupplierRowLike } from '@/lib/supplier/colorCode'

// Расчёт душевой по составу чертежа (SHOWROOM_COST_ROUTE.md, этап Ч3). Для изделий, которых
// нет среди моделей М1…М12 (две распашные двери в нишу и т.п.): створки с размерами и
// фурнитура с артикулами, как подписаны на чертеже, → себестоимость.
//  • Стекло — как в «Расчёте» (buildPrice.ts): B2B-цена пер-панельно, закалка всегда,
//    скидка M GLASS.
//  • Фурнитура — справочник АВ24 по артикулу и цвету: розница × (1 − скидка), округление
//    только у итога (так считает лист закупки владельца). Погонное — целыми полосами.
// Чего нет в справочнике или не читается — остановка, а не догадка. Сверено вручную 08.10
// на чертеже 0014-6: стекло 8 972, фурнитура 18 202,5.

type FinishId = typeof FINISH_IDS[number]

export const COMPOSITION_ROLES = ['hinge', 'handle', 'seal-hinge', 'seal-magnet', 'seal-bottom', 'threshold', 'other'] as const
export type CompositionRole = typeof COMPOSITION_ROLES[number]

const LINEAR = new Set<CompositionRole>(['seal-hinge', 'seal-magnet', 'seal-bottom', 'threshold'])
export const isLinearRole = (r: CompositionRole) => LINEAR.has(r)
// Уплотнители и акриловый порог — расходники: «CL» (прозрачный) подходит к любой фурнитуре.
const axisOf = (r: CompositionRole): ColorAxis => (LINEAR.has(r) ? 'consumable' : 'hardware')

export type CompositionPanel = { label: string; w: number; h: number; derived?: boolean; evidence?: string }
export type CompositionHardware = {
  role: CompositionRole
  label: string
  article: string | null      // как на чертеже: «FDP-230» или с материалом «FDP-230 BR»
  qty?: number                // штучное
  pieces_mm?: number[]        // погонное: длины кусков
  evidence?: string
}
export type CompositionInput = {
  panels: CompositionPanel[]
  finishId: FinishId
  hardware: CompositionHardware[]
}

export type GlassLine = { label: string; w: number; h: number; areaM2: number; pricePerM2: number; listTotal: number; total: number; derived: boolean }
export type HardwareLine = {
  role: CompositionRole
  label: string
  article: string | null      // строка справочника, по которой взята цена
  base: string | null
  fromDrawing: boolean        // false — артикула на чертеже нет, взят ходовой
  qty: number
  unit: number | null
  total: number | null
  stockMm?: number
  layout?: number[][]         // куски по полосам
}
export type CompositionResult = {
  glass: { material: string | null; discountPct: number; lines: GlassLine[]; cost: number }
  hardware: { lines: HardwareLine[]; costExact: number; cost: number }
  doors: number
  stops: string[]
  notes: string[]
  complete: boolean
}

// Ходовые АВ24 (заказ 0245, сверка 08.10) — когда на чертеже есть уплотнитель или порог,
// но без артикула. Это допущение, поэтому строка получает пометку.
export function defaultArticle(role: CompositionRole, label: string, pieces: number[] = []): string | null {
  const t = label.toLowerCase()
  if (role === 'seal-hinge') return 'FDPP-404.8'
  // 502.8 у АВ24 — «магнитный 90°, 180°»: где на подписи есть 90, нужен он; только 180 — 503.8.
  if (role === 'seal-magnet') return /(^|\D)90(\D|$)/.test(t) ? 'FDPP-502.8' : 'FDPP-503.8'
  if (role === 'seal-bottom') return 'FDPP-402.8'
  if (role === 'threshold') return Math.max(0, ...pieces) <= 1000 ? 'FDPP-16.1' : 'FDPP-16.2'
  return null
}

// Длина полосы из названия: «… 2.2 м под стекло 8 мм», «16х8 мм, 1 м прозрачный». «мм» не берём.
export function stockLengthMm(name: string | null | undefined): number | null {
  const all = [...(name ?? '').matchAll(/(\d+(?:[.,]\d+)?)\s*м(?![а-яёa-z])/gi)]
  if (!all.length) return null
  const m = Number(all[all.length - 1][1].replace(',', '.'))
  return m > 0 && m <= 6 ? Math.round(m * 1000) : null
}

// Наибольшие куски первыми, каждый — в первую полосу, где хватает места. Кусок длиннее
// полосы не режем: стык погонного на душевой — решение владельца (решение 4 маршрута).
export function planStrips(pieces: number[], stock: number): { layout: number[][]; tooLong: number[] } {
  const tooLong = pieces.filter(p => p > stock)
  const layout: number[][] = []
  const left: number[] = []
  for (const p of pieces.filter(p => p > 0 && p <= stock).sort((a, b) => b - a)) {
    const i = left.findIndex(l => l >= p)
    if (i >= 0) { layout[i].push(p); left[i] -= p }
    else { layout.push([p]); left.push(stock - p) }
  }
  return { layout, tooLong }
}

// Строки справочника, которые относятся к подписи: точное совпадение или подпись + пробел/«/».
// «FDR-90» не тянет «FDR-90-DEF»; брак и уценку отсекаем отдельно.
export function rowsForArticle(article: string, rows: SupplierRowLike[]): SupplierRowLike[] {
  const a = article.trim()
  return rows.filter(r => !isDefectRow(r) && (r.article === a || r.article.startsWith(`${a} `) || r.article.startsWith(`${a}/`)))
}

const roundKop = (n: number) => Math.round(n * 100) / 100

// Строка цвета — тем же порядком, что pricesByFinish (colorCode.ts): основная партия раньше
// запасной; расходнику без своей строки цвета подходит прозрачный. Строку, а не только цену,
// берём, чтобы в расчёте стоял настоящий артикул: у FDR-90 чёрный и матовый стоят одинаково.
const CLEAR_ORDER: Record<string, string[]> = {
  black: ['clear-black', 'clear', 'clear-white'],
  white: ['clear-white', 'clear', 'clear-black'],
}
export function pickRow(rows: SupplierRowLike[], axis: ColorAxis, finish: FinishId): SupplierRowLike | null {
  const usable = rows
    .filter(r => !isDefectRow(r) && rowCost(r) > 0)
    .sort((a, b) => Number(!!splitAv24Article(a.article)?.alt) - Number(!!splitAv24Article(b.article)?.alt))
  const own = usable.find(r => rowFinish('av24', r, axis) === finish)
  if (own || axis !== 'consumable') return own ?? null
  for (const c of CLEAR_ORDER[finish] ?? ['clear', 'clear-white', 'clear-black']) {
    const r = usable.find(x => rowFinish('av24', x, axis) === c)
    if (r) return r
  }
  return null
}

export function priceComposition(
  input: CompositionInput,
  ctx: {
    glass: B2BMaterial | null
    glassAsked: string
    rates: B2BRates
    mgDiscount: number
    av24: SupplierRowLike[]    // строки АВ24 по всем нужным артикулам (лишние отсекаются здесь)
  },
): CompositionResult {
  const stops: string[] = []
  const notes: string[] = []

  // ── Стекло ────────────────────────────────────────────────────────────────
  const glassLines: GlassLine[] = []
  let glassCost = 0
  if (!ctx.glass) stops.push(`Стекла «${ctx.glassAsked}» нет в справочнике B2B — цена стекла не посчитана`)
  if (!input.panels.length) stops.push('На чертеже не найдено ни одной створки')
  for (const p of input.panels) {
    const w = Math.round(p.w), h = Math.round(p.h)
    if (!(w > 0 && h > 0)) { stops.push(`${p.label}: размер не прочитан`); continue }
    if (p.derived) notes.push(`${p.label}: ${w} × ${h} выведен из цепочки размеров — проверьте`)
    if (!ctx.glass) continue
    // Душевое стекло всегда закалённое (как в buildPrice.ts) — иначе занижение.
    const item = calcItem(ctx.glass, w, h, 1, ctx.glass.waste_percent, true, [], false, null, [], false, 2, null, [], true, ctx.rates)
    const total = effectiveItemTotal(item as B2BOrderItem, ctx.mgDiscount)
    glassCost += total
    glassLines.push({ label: p.label, w, h, areaM2: item.totalAreaNet, pricePerM2: item.pricePerM2, listTotal: item.saleIncVat, total, derived: !!p.derived })
  }

  // ── Фурнитура ─────────────────────────────────────────────────────────────
  const lines: HardwareLine[] = []
  let hwExact = 0
  for (const hw of input.hardware) {
    const linear = isLinearRole(hw.role)
    const pieces = (hw.pieces_mm ?? []).map(Math.round).filter(n => n > 0)
    const fromDrawing = !!hw.article?.trim()
    const asked = fromDrawing ? hw.article!.trim() : defaultArticle(hw.role, hw.label, pieces)
    const line: HardwareLine = { role: hw.role, label: hw.label, article: null, base: null, fromDrawing, qty: 0, unit: null, total: null }
    lines.push(line)
    if (!asked) { stops.push(`${hw.label}: нет артикула на чертеже и нет ходовой позиции — укажите артикул`); continue }
    if (!fromDrawing) notes.push(`${hw.label}: артикула на чертеже нет — взят ходовой ${asked}`)

    const own = rowsForArticle(asked, ctx.av24)
    const bases = [...new Set(own.map(r => articleBase('av24', r.article)))]
    if (!own.length) { stops.push(`${hw.label}: ${asked} нет в справочнике АВ24`); continue }
    if (bases.length > 1) { stops.push(`${hw.label}: у ${asked} несколько исполнений (${bases.join(', ')}) — уточните артикул`); continue }
    line.base = bases[0]

    const row = pickRow(own, axisOf(hw.role), input.finishId)
    if (!row) { stops.push(`${hw.label}: у ${line.base} нет цены нужного цвета`); continue }
    const unit = rowCost(row)
    line.unit = unit
    line.article = row.article

    if (linear) {
      const stockRow = own.find(r => stockLengthMm(r.name) != null)
      const stock = stockLengthMm(stockRow?.name)
      if (!stock) { stops.push(`${hw.label}: длина полосы ${line.base} не читается из названия`); continue }
      if (!pieces.length) { stops.push(`${hw.label}: не прочитаны длины кусков`); continue }
      const plan = planStrips(pieces, stock)
      if (plan.tooLong.length) { stops.push(`${hw.label}: кусок ${plan.tooLong.join(', ')} мм длиннее полосы ${stock} мм`); continue }
      line.qty = plan.layout.length
      line.stockMm = stock
      line.layout = plan.layout
    } else {
      const q = Math.round(hw.qty ?? 0)
      if (!(q > 0)) { stops.push(`${hw.label}: не прочитано количество`); continue }
      line.qty = q
    }
    line.total = roundKop(unit * line.qty)
    hwExact += line.total
  }

  hwExact = roundKop(hwExact)
  return {
    glass: { material: ctx.glass?.name ?? null, discountPct: ctx.mgDiscount, lines: glassLines, cost: glassCost },
    hardware: { lines, costExact: hwExact, cost: Math.round(hwExact) },
    doors: input.panels.length,
    stops,
    notes,
    complete: stops.length === 0,
  }
}
