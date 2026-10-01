import { M_MODELS } from '@/lib/configurator/arrangement'
import { ROLES } from '@/lib/configurator/kit'
import { articleOf } from '@/lib/calc/buildStops'

// Разбор чертежа душевой (Ч2): модель только ЧИТАЕТ чертёж и к каждому полю прикладывает,
// где это на чертеже. Здесь — детерминированный перевод прочитанного в параметры «Расчёта».
// Цена по-прежнему считается кодом; всё, что не прочитано или не ложится в наш выбор,
// становится остановкой, а не догадкой. Маршрут SHOWROOM_COST_ROUTE.md, этап Ч2.

export type Ev<T> = { value: T | null; evidence: string }
export type DrawnHardware = { label: string; role: string | null; article: string | null; evidence: string }
export type DrawnShower = {
  sheet: number
  positions?: string
  model: Ev<string>
  width_mm: Ev<number>
  depth_mm: Ev<number>
  height_mm: Ev<number>
  door_width_mm: Ev<number>
  color: Ev<string>
  glass: Ev<string>
  thickness_mm: Ev<number>
  hardware: DrawnHardware[]
  notes?: string[]
}
export type ShowerDrawingParse = { is_shower_drawing: boolean; showers: DrawnShower[]; warnings?: string[] }

export type DrawingApply = {
  sheet: number
  title: string
  code: string | null
  dims: { width?: number; height?: number; width2?: number; doorWidth?: number }
  finishId: string | null
  glassId: string | null
  drawn: Record<string, string>
  evidence: { field: string; value: string; evidence: string }[]
  stops: string[]     // без ответа на них считать нельзя: не прочитано, не наш цвет/стекло/толщина
  notes: string[]     // нестандарт по сетке модели — считать можно, сказать надо
}

const BUILD_THICKNESS = 8
const BUDGET_FINISHES = new Set(['chrome', 'black'])

// Порядок важен: «осветлённое матовое» раньше «осветлённого» и «матового».
export function glassIdOf(text: string | null | undefined): string | null {
  const t = (text ?? '').toLowerCase().replace(/ё/g, 'е')
  const clearish = /осветл|crystal|optiwhite|оптивайт/.test(t)
  const matte = /мат|сатин|matelux/.test(t)
  if (clearish && matte) return 'matte-crystal'
  if (matte) return 'matte'
  if (clearish) return 'crystal'
  if (/графит/.test(t)) return 'graphite'
  if (/бронз/.test(t)) return 'bronze'
  if (/прозрачн|бесцветн/.test(t)) return 'clear'
  return null
}

export function finishIdOf(text: string | null | undefined): string | null {
  const t = (text ?? '').toLowerCase().replace(/ё/g, 'е')
  if (/черн|black/.test(t)) return 'black'
  if (/оружейн|gunmetal/.test(t)) return 'gunmetal'
  if (/роз/.test(t)) return /мат/.test(t) ? 'brrose' : 'rose'
  if (/золот|gold/.test(t)) return /мат/.test(t) ? 'brgold' : 'gold'
  if (/бронз/.test(t)) return 'bronze'
  if (/бел/.test(t)) return 'white'
  if (/хром|chrome|нерж|глянц/.test(t)) return /мат/.test(t) ? 'satin' : 'chrome'
  return null
}

const num = (e: Ev<number> | undefined) => (e && typeof e.value === 'number' && e.value > 0 ? Math.round(e.value) : undefined)
const range = ([lo, hi]: [number, number]) => `${lo}–${hi}`

export function drawingToRequest(s: DrawnShower): DrawingApply {
  const stops: string[] = []
  const notes: string[] = []
  const evidence: DrawingApply['evidence'] = []
  const ev = (field: string, e: Ev<unknown> | undefined) => {
    if (e && e.value != null && e.value !== '') evidence.push({ field, value: String(e.value), evidence: e.evidence })
  }

  const model = M_MODELS.find(m => m.code === s.model?.value) ?? null
  ev('модель', s.model)
  if (!model) stops.push('Модель не распознана — выберите вручную')

  const width = num(s.width_mm), height = num(s.height_mm), width2 = num(s.depth_mm), doorWidth = num(s.door_width_mm)
  ev('ширина', s.width_mm); ev('глубина', s.depth_mm); ev('высота', s.height_mm); ev('дверь', s.door_width_mm)
  if (!width) stops.push('Ширина не прочитана')
  if (!height) stops.push('Высота не прочитана')
  if (model?.constraints.needsWidth2 && !width2) stops.push('Глубина (боковая сторона) не прочитана')
  if (model?.constraints.doorWidth && !doorWidth) stops.push('Ширина двери не прочитана')
  if (model) {
    const c = model.constraints
    const out = (label: string, v: number | undefined, r: [number, number] | undefined) => {
      if (v && r && (v < r[0] || v > r[1])) notes.push(`${label} ${v} вне сетки ${model.code} ${range(r)} — нестандарт`)
    }
    out('Ширина', width, c.width)   // высоту вне сетки отмечает buildStops — не дублируем
    if (c.needsWidth2) out('Глубина', width2, c.width2)
    out('Дверь', doorWidth, c.doorWidth)
  }

  ev('цвет', s.color)
  const finishId = finishIdOf(s.color?.value)
  if (!s.color?.value) stops.push('Цвет фурнитуры не прочитан')
  else if (!finishId) stops.push(`Цвет «${s.color.value}» не распознан — выберите вручную`)
  else if (!BUDGET_FINISHES.has(finishId)) stops.push(`Цвет «${s.color.value}» — в «Расчёте» только хром и чёрный`)

  ev('стекло', s.glass)
  const glassId = glassIdOf(s.glass?.value)
  if (!s.glass?.value) stops.push('Стекло не прочитано')
  else if (!glassId) stops.push(`Стекло «${s.glass.value}» не сопоставлено — выберите вручную`)

  ev('толщина', s.thickness_mm)
  const t = num(s.thickness_mm)
  if (t && t !== BUILD_THICKNESS) stops.push(`На чертеже стекло ${t} мм, «Расчёт» считает ${BUILD_THICKNESS} мм`)

  // Подпись артикула по роли — первая с артикулом. Её сверит Ч1 (buildStops) с расчётом.
  const drawn: Record<string, string> = {}
  for (const h of s.hardware ?? []) {
    const art = articleOf(h.article ?? '') || articleOf(h.label)
    if (!art || !h.role || !(ROLES as readonly string[]).includes(h.role) || drawn[h.role]) continue
    drawn[h.role] = art
    evidence.push({ field: h.role, value: art, evidence: h.evidence || h.label })
  }

  const dims = { width, height, ...(width2 ? { width2 } : {}), ...(doorWidth ? { doorWidth } : {}) }
  const size = [width, width2, height].filter(Boolean).join('×')
  return {
    sheet: s.sheet,
    title: `Лист ${s.sheet}${s.positions ? ` (${s.positions})` : ''} · ${model?.code ?? '?'}${size ? ` ${size}` : ''}`,
    code: model?.code ?? null, dims, finishId, glassId, drawn, evidence, stops, notes,
  }
}

// Сверка разбора с эталоном: что модель прочитала не так. Для живой проверки на PDF 0245.
export function compareToFixture(actual: ShowerDrawingParse, expected: ShowerDrawingParse): string[] {
  const out: string[] = []
  for (const want of expected.showers) {
    const got = actual.showers.find(s => s.sheet === want.sheet)
    if (!got) { out.push(`лист ${want.sheet}: душевая не найдена`); continue }
    const a = drawingToRequest(got), e = drawingToRequest(want)
    const cmp = (label: string, x: unknown, y: unknown) => { if (JSON.stringify(x) !== JSON.stringify(y)) out.push(`лист ${want.sheet} ${label}: ${JSON.stringify(x)} вместо ${JSON.stringify(y)}`) }
    cmp('модель', a.code, e.code); cmp('размеры', a.dims, e.dims); cmp('цвет', a.finishId, e.finishId)
    cmp('стекло', a.glassId, e.glassId)
    for (const role of Object.keys(e.drawn)) cmp(`артикул ${role}`, a.drawn[role] ?? null, e.drawn[role])
  }
  return out
}
