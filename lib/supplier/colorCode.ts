import { supplierColorToFinish, FINISH_IDS, type PriceByColor } from '@/lib/configurator/pricing'

// Цвет строки прайса поставщика → цвет визуализатора. У АВ24 цвет зашит кодом в артикул:
// «FDP-232 BR/BL» — артикул FDP-232, материал BR (латунь), цвет BL (чёрный). Поле color
// у части строк — слово («черный»), у части — тот же код без слова («BL», «TP», «BZ»):
// по одному слову чёрные уплотнители и крепления никогда не получали цену и молча шли
// по хрому. Код артикула надёжнее слова, поэтому АВ24 читается по коду, слово — запасной путь.
//
// Ось цвета у расходников своя. Уплотнитель «CL» — прозрачный и подходит к любой фурнитуре,
// «GG» у него — серый, а не «оружейная сталь» (проверено по названиям строк 01.10).

export type ColorAxis = 'hardware' | 'consumable'
export const colorAxisOfRole = (role: string): ColorAxis => (role.startsWith('seal') ? 'consumable' : 'hardware')

type FinishId = typeof FINISH_IDS[number]
type Clear = 'clear' | 'clear-black' | 'clear-white'
export type RowFinish = FinishId | Clear | null

// MG/STP («матовое золото») не сопоставлены: у позиции бывает и BTP (брашированное), и MG —
// разные исполнения по разной цене, а цвет визуализатора у них один.
const AV24_HARDWARE: Record<string, FinishId> = {
  BL: 'black', CR: 'chrome', PSS: 'chrome', SSS: 'satin', GG: 'gunmetal', BZ: 'bronze',
  TP: 'gold', BTP: 'brgold', MW: 'white', RG: 'rose', RTP: 'brrose', SRTP: 'brrose',
}
const AV24_CONSUMABLE: Record<string, FinishId | Clear> = {
  BL: 'black', MW: 'white', CL: 'clear', CLGR: 'clear', 'CL-BL': 'clear-black', 'CL-W': 'clear-white',
}

// «FDC-30 SUS304/BTP/L» — «светлее», другая партия того же цвета; «FDPP-102.8 PVC/BL(US18)» —
// вариант исполнения. Оба — запасные: основная строка цвета важнее.
export type Av24Article = { base: string; code: string; alt: boolean }
export function splitAv24Article(article: string): Av24Article | null {
  const m = (article || '').trim().match(/^(.*\s\S+?)\/([A-Za-z0-9-]+)(\([^)]*\))?(\/L)?$/)
  if (!m) return null
  return { base: m[1].trim(), code: m[2].toUpperCase(), alt: !!m[3] || !!m[4] }
}

// Двухцветное исполнение («черный с белой крышкой») — не цвет фурнитуры целиком: подставить
// его в чёрный комплект значит продать белую крышку под видом чёрной.
const twoTone = (t: string) => /\sс\s.*крышк/i.test(t)

export function rowFinish(supplier: string, row: { article: string; color?: string | null }, axis: ColorAxis = 'hardware'): RowFinish {
  const color = row.color ?? ''
  if (twoTone(color)) return null
  if (supplier === 'av24') {
    const a = splitAv24Article(row.article)
    if (a) {
      if (axis === 'consumable') return AV24_CONSUMABLE[a.code] ?? null
      if (/^PSS\d+K$/.test(a.code)) return 'chrome'                    // полировка 4K…16K — тот же хром
      // Код разобран, но не наш цвет (MG, BN, SNG, двухцветные BL-MW…): слову не верим —
      // «матовое золото» по слову стало бы «золотом» и перебило бы цену TP.
      return AV24_HARDWARE[a.code] ?? null
    }
    if (axis === 'consumable') return null
  }
  return supplierColorToFinish(color) as FinishId | null
}

export type SupplierRowLike = {
  article: string
  color?: string | null
  name?: string | null
  retail_price?: number | string | null
  discount_percent?: number | string | null
  cost_price?: number | string | null
}

export const isDefectRow = (r: { article: string; name?: string | null }) =>
  /-DEF\b/i.test(r.article) || /дефект|уценк/i.test(r.name ?? '')

// Себестоимость = розница × (1 − скидка поставщика) с копейками: cost_price в базе округлён
// до рубля при импорте, и на десятке позиций по 0,5 ₽ расходится с листом закупки.
export function rowCost(r: SupplierRowLike): number {
  const retail = Number(r.retail_price)
  const disc = Number(r.discount_percent)
  if (retail > 0 && Number.isFinite(disc)) return Math.round(retail * (1 - disc / 100) * 100) / 100
  return Math.max(0, Number(r.cost_price) || 0)
}

// Цены позиции по цветам из её строк у поставщика. Чужие исполнения отсекает вызывающий
// (строки одной базы артикула); здесь — брак, нулевые цены, запасные партии и прозрачные
// расходники, которые закрывают цвета без своей строки.
export function pricesByFinish(supplier: string, rows: SupplierRowLike[], axis: ColorAxis = 'hardware'): PriceByColor {
  const own: Partial<Record<FinishId, number>> = {}
  const clear: Partial<Record<Clear, number>> = {}
  const usable = rows
    .filter(r => !isDefectRow(r) && rowCost(r) > 0)
    .map(r => ({ r, alt: supplier === 'av24' ? !!splitAv24Article(r.article)?.alt : false }))
    .sort((a, b) => Number(a.alt) - Number(b.alt))
  for (const { r } of usable) {
    const f = rowFinish(supplier, r, axis)
    if (!f) continue
    const cost = rowCost(r)
    if (f === 'clear' || f === 'clear-black' || f === 'clear-white') { clear[f] ??= cost; continue }
    own[f] ??= cost
  }
  const out: PriceByColor = {}
  for (const f of FINISH_IDS) {
    const viaClear = f === 'black' ? clear['clear-black'] ?? clear.clear ?? clear['clear-white']
      : f === 'white' ? clear['clear-white'] ?? clear.clear ?? clear['clear-black']
      : clear.clear ?? clear['clear-white'] ?? clear['clear-black']
    const v = own[f] ?? viaClear
    if (v != null) out[f] = v
  }
  return out
}

// База артикула для поиска всех цветов позиции: у АВ24 — до кода цвета (материал остаётся
// в базе: FDP-115 BR и FDP-115 SUS304 — разные петли с разной ценой), у остальных — до
// последнего «/», как раньше.
export function articleBase(supplier: string, article: string): string {
  if (supplier === 'av24') {
    const a = splitAv24Article(article)
    if (a) return a.base
  }
  const slash = article.lastIndexOf('/')
  return slash > 0 ? article.slice(0, slash) : article
}
