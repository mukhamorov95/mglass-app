// Контракт /api/glasmen-demo/* (app/api/glasmen-demo/*/route.ts). Типы цены — из lib/glasmen/priceModel.ts.
import type { PriceModelId, PriceModelParams, PriceLadderRow, LadderTier } from '@/lib/glasmen/priceModel'

export type { PriceModelParams, LadderTier }
export type ModelId = PriceModelId

export const MODEL_IDS: ModelId[] = ['current', 'aLine', 'aGroup', 'ladderB', 'minC']

// Подпись переключателя; заголовок и описание варианта приходят из API (PRESETS).
export const MODEL_LABEL: Record<ModelId, string> = {
  current: 'Сейчас',
  aLine: 'A — наладка на строку',
  aGroup: 'A — наладка на заказ × материал',
  ladderB: 'B — лесенка за серию',
  minC: 'C — минимальный заказ',
}

export type DemoMaterial = {
  id: number
  name: string
  category: string
  thickness: number
  pricePerM2: number          // ₽ вкл. НДС, общий прайс до скидки
  temperable: boolean | null  // null — нет ставки закалки этой толщины, неизвестно
}

export type MaterialsResponse = {
  materials: DemoMaterial[]
  combos: number
  facetTypesMm?: number[]     // ширины фацета из активных строк facet_prices
  categories?: { category: string; count: number }[]
  notes?: string[]
  warnings?: string[]
}

export type ParamsOverride = Partial<PriceModelParams>

export type QuoteBody = {
  materialId: number
  width: number
  height: number
  shape?: 'rect' | 'curved'
  holes?: { d: number; n: number }[]
  cutouts?: number
  hasTempering?: boolean
  hasFacet?: boolean
  facetTypeMm?: number
  quantities?: number[]
  discountPct?: number
  models?: ModelId[]
  params?: Partial<Record<ModelId, ParamsOverride>>
  asWholeOrder?: boolean      // деталь — весь заказ: минимум заказа M внутри строки
  groupLines?: number         // aGroup: сколько строк одного материала делят наладку
  groupIndex?: number         // aGroup: номер строки в этой группе (0…groupLines−1)
}

export type QuoteRow = PriceLadderRow

export type QuoteModelResult = {
  title: string
  description: string
  source: string
  params: PriceModelParams              // параметры после sanitizeParams — то, чем реально посчитано
  paramsUsed: (keyof PriceModelParams)[]
  rows: QuoteRow[]
}

export type QuoteResponse = {
  material: DemoMaterial
  areaPieceM2: number                   // по габариту W×H — эта площадь идёт в цену
  weightPieceKg: number                 // по той же площади
  v1: number
  floorPerPiece: number
  discountPct: number
  surcharges: { name: string; pct: number }[]
  models: Partial<Record<ModelId, QuoteModelResult>>
  warnings: string[]
}

export const QUANTITIES = [1, 2, 5, 10, 25, 50]

export const isMirror = (m: Pick<DemoMaterial, 'category' | 'name'> | null | undefined) =>
  !!m && (/зеркал|mirror/i.test(m.category) || /^зеркало/i.test(m.name))

// Закалка недоступна: зеркало или справочник прямо говорит «не закаливается».
export const canTemper = (m: DemoMaterial | null | undefined) => !!m && !isMirror(m) && m.temperable !== false

const rubFmt0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })
const rubFmt2 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Рубли как пришли: целые — без копеек, с копейками — две цифры (показываем то, что вернул расчёт).
export function rub(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const cents = Math.round(n * 100)
  const s = cents % 100 === 0 ? rubFmt0.format(cents / 100) : rubFmt2.format(cents / 100)
  return `${s.replace(/\s/g, '\u202f').replace(/^-/, '\u2212')} ₽`
}

export function num(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(n).replace(/\s/g, '\u202f').replace(/^-/, '\u2212')
}

export const VAT_LABEL = 'вкл. НДС 22 %'

export function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100, b = a % 10
  if (a > 10 && a < 20) return many
  if (b > 1 && b < 5) return few
  if (b === 1) return one
  return many
}
