import type { DfmIssue, HoleGeom, PartGeometry, Pt, Seg } from './types'
import { TAU, arc, buildPart, circleSegs, line, numRu, segLength } from './geom'

// Параметрические детали без чертежа (как Parts Builder у SendCutSend).
// Система координат — как в PartGeometry: мм, (0,0) — левый верхний угол, y вниз.

export type TemplateParam = {
  key: string
  label: string
  min: number; max: number; step: number; default: number
  unit: 'мм' | 'шт' | ''
  options?: { value: number; label: string }[]   // выпадающий список вместо ползунка
  visibleIf?: { key: string; atLeast?: number; equals?: number }  // показывать, только если другой параметр ≥ / = значению
}

export type TemplateParams = Record<string, number>

export type PartTemplate = {
  id: TemplateId
  title: string
  description: string
  params: TemplateParam[]
  build: (p?: Partial<TemplateParams>) => PartGeometry
}

export type TemplateId = 'rect' | 'circle' | 'ellipse' | 'arch' | 'shelf' | 'rectWithHoles' | 'splashback' | 'showerPanel'

const mm = (key: string, label: string, min: number, max: number, def: number, step = 1): TemplateParam =>
  ({ key, label, min, max, step, default: def, unit: 'мм' })

const UNITS_MM: PartGeometry['units'] = { detected: 'mm', applied: 'mm', factorToMm: 1 }

export function resolveParams(params: TemplateParam[], input: Partial<TemplateParams> = {}): { p: TemplateParams; issues: DfmIssue[] } {
  const p: TemplateParams = {}
  const issues: DfmIssue[] = []
  for (const d of params) {
    const raw = input[d.key]
    const v = typeof raw === 'number' && Number.isFinite(raw) ? raw : d.default
    const c = Math.min(d.max, Math.max(d.min, v))
    if (c !== v) issues.push(clampIssue(d.label, v, c, `${numRu(d.min)}–${numRu(d.max)}${d.unit ? ' ' + d.unit : ''}`))
    p[d.key] = c
  }
  return { p, issues }
}

function clampIssue(label: string, asked: number, used: number, range: string): DfmIssue {
  return { code: 'param_clamped', level: 'soft', message: `«${label}»: ${numRu(asked)} вне допустимого (${range}), взято ${numRu(used)}.` }
}

// Прямоугольник со скруглениями [ЛВ, ПВ, ПН, ЛН], обход по часовой на экране.
export function roundedRectSegs(x: number, y: number, w: number, h: number, r: [number, number, number, number] = [0, 0, 0, 0]): Seg[] {
  const [tl, tr, br, bl] = r
  const P = (px: number, py: number): Pt => ({ x: px, y: py })
  const segs: Seg[] = [
    line(P(x + tl, y), P(x + w - tr, y)),
    arc(P(x + w - tr, y + tr), tr, -Math.PI / 2, Math.PI / 2),
    line(P(x + w, y + tr), P(x + w, y + h - br)),
    arc(P(x + w - br, y + h - br), br, 0, Math.PI / 2),
    line(P(x + w - br, y + h), P(x + bl, y + h)),
    arc(P(x + bl, y + h - bl), bl, Math.PI / 2, Math.PI / 2),
    line(P(x, y + h - bl), P(x, y + tl)),
    arc(P(x + tl, y + tl), tl, Math.PI, Math.PI / 2),
  ]
  return segs.filter(s => (s.kind === 'arc' ? s.r > 1e-9 : segLength(s) > 1e-9))
}

function ellipseSegs(cx: number, cy: number, a: number, b: number, n = 360): Seg[] {
  const pts: Pt[] = []
  for (let i = 0; i < n; i++) pts.push({ x: cx + a * Math.cos((TAU * i) / n), y: cy + b * Math.sin((TAU * i) / n) })
  return pts.map((p, i) => line(p, pts[(i + 1) % n]))
}

function limitRadius(r: number, max: number, label: string, issues: DfmIssue[]): number {
  if (r <= max + 1e-9) return r
  issues.push(clampIssue(label, r, max, `не больше ${numRu(max)} мм при этих размерах`))
  return max
}

const evenly = (from: number, to: number, n: number): number[] =>
  n <= 0 ? [] : n === 1 ? [(from + to) / 2] : Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1))

function part(name: string, outer: Seg[], holes: HoleGeom[], cutouts: Seg[][], issues: DfmIssue[]): PartGeometry {
  return buildPart({ source: 'template', name, units: UNITS_MM, outer, holes, cutouts, issues })
}

const rect: PartTemplate = {
  id: 'rect',
  title: 'Прямоугольник',
  description: 'Стекло или зеркало прямоугольной формы, углы острые или скруглённые.',
  params: [mm('W', 'Ширина', 30, 6000, 1000), mm('H', 'Высота', 30, 6000, 600), mm('R', 'Радиус углов', 0, 500, 0)],
  build(input) {
    const { p, issues } = resolveParams(rect.params, input)
    const R = limitRadius(p.R, Math.min(p.W, p.H) / 2, 'Радиус углов', issues)
    return part(`Прямоугольник ${numRu(p.W)}×${numRu(p.H)}${R ? ` R${numRu(R)}` : ''}`, roundedRectSegs(0, 0, p.W, p.H, [R, R, R, R]), [], [], issues)
  },
}

const circle: PartTemplate = {
  id: 'circle',
  title: 'Круг',
  description: 'Круглое зеркало или стекло: столешница, полка, иллюминатор.',
  params: [mm('D', 'Диаметр', 30, 3200, 600)],
  build(input) {
    const { p, issues } = resolveParams(circle.params, input)
    return part(`Круг Ø${numRu(p.D)}`, circleSegs({ x: p.D / 2, y: p.D / 2 }, p.D / 2), [], [], issues)
  },
}

const ellipse: PartTemplate = {
  id: 'ellipse',
  title: 'Овал',
  description: 'Овальное зеркало по ширине и высоте.',
  params: [mm('W', 'Ширина', 30, 3600, 800), mm('H', 'Высота', 30, 3600, 500)],
  build(input) {
    const { p, issues } = resolveParams(ellipse.params, input)
    return part(`Овал ${numRu(p.W)}×${numRu(p.H)}`, ellipseSegs(p.W / 2, p.H / 2, p.W / 2, p.H / 2), [], [], issues)
  },
}

const arch: PartTemplate = {
  id: 'arch',
  title: 'Арка',
  description: 'Прямоугольник с дугой сверху: зеркало-арка, стекло в арочный проём.',
  params: [mm('W', 'Ширина', 100, 3600, 900), mm('H', 'Высота', 100, 3600, 2000), mm('A', 'Подъём дуги', 0, 1800, 300)],
  build(input) {
    const { p, issues } = resolveParams(arch.params, input)
    const { W, H } = p
    const A = limitRadius(p.A, Math.min(W / 2, H), 'Подъём дуги', issues)
    let outer: Seg[]
    if (A < 0.01) outer = roundedRectSegs(0, 0, W, H)
    else {
      const R = (W * W / 4 + A * A) / (2 * A)
      const c = { x: W / 2, y: R }
      const s = Math.atan2(A - R, -W / 2), e = Math.atan2(A - R, W / 2)
      outer = [
        line({ x: 0, y: H }, { x: 0, y: A }),
        arc(c, R, s, (((e - s) % TAU) + TAU) % TAU),
        line({ x: W, y: A }, { x: W, y: H }),
        line({ x: W, y: H }, { x: 0, y: H }),
      ].filter(sg => sg.kind === 'arc' || segLength(sg) > 1e-9)
    }
    return part(`Арка ${numRu(W)}×${numRu(H)}, подъём ${numRu(A)}`, outer, [], [], issues)
  },
}

const shelf: PartTemplate = {
  id: 'shelf',
  title: 'Полка',
  description: 'Стеклянная полка: задняя кромка к стене, передние углы скруглены, по желанию два отверстия под крепёж.',
  params: [
    mm('W', 'Длина', 100, 2000, 600), mm('D', 'Глубина', 80, 600, 200), mm('R', 'Радиус передних углов', 0, 150, 20),
    mm('holeD', 'Диаметр отверстий (0 — без отверстий)', 0, 30, 0, 0.5),
    { ...mm('holeBack', 'Отверстия: от задней кромки до центра', 10, 300, 40), visibleIf: { key: 'holeD', atLeast: 1 } },
    { ...mm('holeSide', 'Отверстия: от боковой кромки до центра', 10, 500, 60), visibleIf: { key: 'holeD', atLeast: 1 } },
  ],
  build(input) {
    const { p, issues } = resolveParams(shelf.params, input)
    const R = limitRadius(p.R, Math.min(p.W / 2, p.D), 'Радиус передних углов', issues)
    const holes: HoleGeom[] = p.holeD > 0
      ? [{ cx: p.holeSide, cy: p.holeBack, d: p.holeD }, { cx: p.W - p.holeSide, cy: p.holeBack, d: p.holeD }]
      : []
    return part(`Полка ${numRu(p.W)}×${numRu(p.D)}`, roundedRectSegs(0, 0, p.W, p.D, [0, 0, R, R]), holes, [], issues)
  },
}

const rectWithHoles: PartTemplate = {
  id: 'rectWithHoles',
  title: 'Прямоугольник с отверстиями',
  description: 'Зеркало или панель на дистанционных держателях: отверстия по углам или в ряд вдоль длинной стороны.',
  params: [
    mm('W', 'Ширина', 100, 3600, 1000), mm('H', 'Высота', 100, 3600, 600),
    { key: 'layout', label: 'Расположение отверстий', min: 0, max: 1, step: 1, default: 1, unit: '', options: [{ value: 0, label: 'В ряд вдоль длинной стороны' }, { value: 1, label: 'По четырём углам' }] },
    { key: 'n', label: 'Число отверстий в ряду', min: 1, max: 10, step: 1, default: 3, unit: 'шт', visibleIf: { key: 'layout', equals: 0 } },
    mm('d', 'Диаметр отверстий', 4, 50, 10, 0.5),
    mm('offset', 'От кромки до центра отверстия', 10, 300, 45),
  ],
  build(input) {
    const { p, issues } = resolveParams(rectWithHoles.params, input)
    const { W, H, d, offset: o } = p
    let holes: HoleGeom[]
    if (p.layout === 1) holes = [[o, o], [W - o, o], [W - o, H - o], [o, H - o]].map(([cx, cy]) => ({ cx, cy, d }))
    else if (W >= H) holes = evenly(o, W - o, Math.round(p.n)).map(cx => ({ cx, cy: o, d }))
    else holes = evenly(o, H - o, Math.round(p.n)).map(cy => ({ cx: o, cy, d }))
    return part(`Прямоугольник ${numRu(W)}×${numRu(H)}, ${holes.length} отв. Ø${numRu(d)}`, roundedRectSegs(0, 0, W, H), holes, [], issues)
  },
}

const socket = (n: 1 | 2, x: number): TemplateParam[] => [
  { ...mm(`s${n}W`, `Вырез ${n}: ширина`, 20, 400, 75), visibleIf: { key: 'sockets', atLeast: n } },
  { ...mm(`s${n}H`, `Вырез ${n}: высота`, 20, 400, 75), visibleIf: { key: 'sockets', atLeast: n } },
  { ...mm(`s${n}R`, `Вырез ${n}: радиус углов`, 0, 100, 8), visibleIf: { key: 'sockets', atLeast: n } },
  { ...mm(`s${n}X`, `Вырез ${n}: центр от левой кромки`, 10, 3600, x), visibleIf: { key: 'sockets', atLeast: n } },
  { ...mm(`s${n}Y`, `Вырез ${n}: центр от верхней кромки`, 10, 1500, 300), visibleIf: { key: 'sockets', atLeast: n } },
]

const splashback: PartTemplate = {
  id: 'splashback',
  title: 'Фартук для кухни',
  description: 'Стеклянный фартук с вырезами под розетки и выключатели (до двух).',
  params: [
    mm('W', 'Длина', 300, 3600, 2000), mm('H', 'Высота', 100, 1500, 600),
    { key: 'sockets', label: 'Вырезов под розетки', min: 0, max: 2, step: 1, default: 2, unit: 'шт' },
    ...socket(1, 400), ...socket(2, 1600),
  ],
  build(input) {
    const { p, issues } = resolveParams(splashback.params, input)
    const cutouts: Seg[][] = []
    for (const n of [1, 2] as const) {
      if (p.sockets < n) continue
      const w = p[`s${n}W`], h = p[`s${n}H`]
      const r = limitRadius(p[`s${n}R`], Math.min(w, h) / 2, `Вырез ${n}: радиус углов`, issues)
      cutouts.push(roundedRectSegs(p[`s${n}X`] - w / 2, p[`s${n}Y`] - h / 2, w, h, [r, r, r, r]))
    }
    return part(`Фартук ${numRu(p.W)}×${numRu(p.H)}`, roundedRectSegs(0, 0, p.W, p.H), [], cutouts, issues)
  },
}

const showerPanel: PartTemplate = {
  id: 'showerPanel',
  title: 'Дверь или панель душевой',
  description: 'Полотно душевой с отверстиями под петли вдоль одной кромки.',
  params: [
    mm('W', 'Ширина', 200, 1400, 800), mm('H', 'Высота', 500, 2600, 2000),
    { key: 'side', label: 'Сторона петель', min: 0, max: 1, step: 1, default: 0, unit: '', options: [{ value: 0, label: 'Слева' }, { value: 1, label: 'Справа' }] },
    { key: 'k', label: 'Число петель', min: 0, max: 4, step: 1, default: 2, unit: 'шт' },
    { ...mm('d', 'Диаметр отверстия под петлю', 6, 40, 16, 0.5), visibleIf: { key: 'k', atLeast: 1 } },
    { ...mm('offset', 'От боковой кромки до центра отверстия', 10, 200, 30), visibleIf: { key: 'k', atLeast: 1 } },
    { ...mm('fromTop', 'Верхняя петля: от верхней кромки', 30, 1000, 250), visibleIf: { key: 'k', atLeast: 1 } },
    { ...mm('fromBottom', 'Нижняя петля: от нижней кромки', 30, 1000, 250), visibleIf: { key: 'k', atLeast: 2 } },
  ],
  build(input) {
    const { p, issues } = resolveParams(showerPanel.params, input)
    const k = Math.round(p.k)
    const ys = k === 1 ? [p.fromTop] : evenly(p.fromTop, p.H - p.fromBottom, k)
    const cx = p.side === 1 ? p.W - p.offset : p.offset
    const holes = ys.map(cy => ({ cx, cy, d: p.d }))
    return part(`Полотно душевой ${numRu(p.W)}×${numRu(p.H)}`, roundedRectSegs(0, 0, p.W, p.H), holes, [], issues)
  },
}

export const TEMPLATES: PartTemplate[] = [rect, circle, ellipse, arch, shelf, rectWithHoles, splashback, showerPanel]

export function getTemplate(id: string): PartTemplate | undefined {
  return TEMPLATES.find(t => t.id === id)
}

export function defaultParams(t: PartTemplate): TemplateParams {
  return Object.fromEntries(t.params.map(p => [p.key, p.default]))
}
