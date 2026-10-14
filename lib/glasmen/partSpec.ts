import type { DfmIssue, HoleGeom, PartGeometry, Seg } from './types'
import { MAX_HOLE_D_MM } from './types'
import { buildPart, circleSegs, line, numRu } from './geom'
import { archSegs, clampIssue, ellipseSegs, evenly, limitRadius, roundedRectSegs } from './templates'

// Деталь из ответов на шаги расчёта: размеры → форма → отверстия и вырезы.
// Положение отверстий и вырезов — типовое (по углам, в ряд); точное задаёт чертёж DXF.

export type ShapeKind = 'rect' | 'rounded' | 'bevel' | 'circle' | 'ellipse' | 'arch'

export const SHAPES: { id: ShapeKind; title: string; hint: string }[] = [
  { id: 'rect', title: 'Прямоугольник', hint: 'Острые углы 90°.' },
  { id: 'rounded', title: 'Скруглённые углы', hint: 'Прямоугольник, все четыре угла по радиусу.' },
  { id: 'bevel', title: 'Скос', hint: 'Трапеция: верхняя кромка под углом (душевая под скат, ниша).' },
  { id: 'circle', title: 'Круг', hint: 'Диаметр = ширина.' },
  { id: 'ellipse', title: 'Овал', hint: 'По ширине и высоте.' },
  { id: 'arch', title: 'Арка', hint: 'Прямоугольник с дугой сверху.' },
]

// corners — четыре по углам; rowTop — ряд вдоль верхней кромки; rowSide — ряд вдоль левой кромки (петли).
export type HoleLayout = 'corners' | 'rowTop' | 'rowSide'
export const HOLE_LAYOUTS: { id: HoleLayout; title: string }[] = [
  { id: 'corners', title: 'По четырём углам' },
  { id: 'rowTop', title: 'В ряд вдоль верхней кромки' },
  { id: 'rowSide', title: 'В ряд вдоль боковой кромки (петли)' },
]

export type HoleGroup = {
  d: number            // диаметр, мм
  n: number            // штук (для «по углам» — всегда 4)
  layout: HoleLayout
  edge: number         // от кромки до центра отверстия, мм
  end: number          // ряд: от торца до центра крайнего отверстия, мм
}

export type CutoutGroup = {
  w: number; h: number // размер выреза, мм
  r: number            // радиус углов выреза, мм
  n: number            // штук в ряд по ширине детали
  fromTop: number      // от верхней кромки до центра выреза, мм
}

export type PartSpec = {
  shape: ShapeKind
  W: number; H: number
  R: number            // rounded: радиус углов
  A: number            // arch: подъём дуги
  HL: number; HR: number  // bevel: высота левой и правой сторон
  holes: HoleGroup[]
  cutouts: CutoutGroup[]
}

export const SPEC_LIMITS = {
  side: [30, 6000], ellipse: [30, 3600], circle: [30, 3200],
  holeD: [4, MAX_HOLE_D_MM], holeN: [1, 20], holeEdge: [5, 1000],
  cutSide: [10, 1500], cutN: [1, 10],
} as const

export const DEFAULT_HOLE: HoleGroup = { d: 10, n: 4, layout: 'corners', edge: 45, end: 100 }
export const DEFAULT_CUTOUT: CutoutGroup = { w: 75, h: 75, r: 8, n: 1, fromTop: 300 }

export const defaultSpec = (): PartSpec => ({ shape: 'rect', W: 1000, H: 600, R: 20, A: 200, HL: 600, HR: 450, holes: [], cutouts: [] })

function clamp(v: number, [lo, hi]: readonly [number, number], label: string, issues: DfmIssue[], unit = 'мм'): number {
  const x = Number.isFinite(v) ? v : lo
  const c = Math.min(hi, Math.max(lo, x))
  if (c !== x || !Number.isFinite(v)) issues.push(clampIssue(label, Number.isFinite(v) ? v : 0, c, `${numRu(lo)}–${numRu(hi)} ${unit}`))
  return c
}

// Габарит по форме: круг квадратный (D = W), у остальных — W × H.
export function specSize(spec: PartSpec): { W: number; H: number } {
  return spec.shape === 'circle' ? { W: spec.W, H: spec.W } : { W: spec.W, H: spec.H }
}

function outerOf(spec: PartSpec, W: number, H: number, issues: DfmIssue[]): { outer: Seg[]; label: string } {
  switch (spec.shape) {
    case 'rounded': {
      const R = limitRadius(Math.max(0, spec.R), Math.min(W, H) / 2, 'Радиус углов', issues)
      return { outer: roundedRectSegs(0, 0, W, H, [R, R, R, R]), label: `R${numRu(R)}` }
    }
    case 'bevel': {
      const HL = clamp(spec.HL, [30, H], 'Высота левой стороны', issues)
      const HR = clamp(spec.HR, [30, H], 'Высота правой стороны', issues)
      if (HL === H && HR === H) return { outer: roundedRectSegs(0, 0, W, H), label: '' }
      const pts = [{ x: 0, y: H - HL }, { x: W, y: H - HR }, { x: W, y: H }, { x: 0, y: H }]
      return { outer: pts.map((p, i) => line(p, pts[(i + 1) % pts.length])), label: `скос ${numRu(HL)}/${numRu(HR)}` }
    }
    case 'circle':
      return { outer: circleSegs({ x: W / 2, y: W / 2 }, W / 2), label: '' }
    case 'ellipse':
      return { outer: ellipseSegs(W / 2, H / 2, W / 2, H / 2), label: '' }
    case 'arch': {
      const A = limitRadius(Math.max(0, spec.A), Math.min(W / 2, H), 'Подъём дуги', issues)
      return { outer: archSegs(W, H, A), label: `подъём ${numRu(A)}` }
    }
    default:
      return { outer: roundedRectSegs(0, 0, W, H), label: '' }
  }
}

function holesOf(g: HoleGroup, W: number, H: number, issues: DfmIssue[]): HoleGeom[] {
  const d = clamp(g.d, SPEC_LIMITS.holeD, 'Диаметр отверстия', issues)
  const e = clamp(g.edge, SPEC_LIMITS.holeEdge, 'От кромки до центра отверстия', issues)
  if (g.layout === 'corners') return [[e, e], [W - e, e], [W - e, H - e], [e, H - e]].map(([cx, cy]) => ({ cx, cy, d }))
  const n = Math.round(clamp(g.n, SPEC_LIMITS.holeN, 'Число отверстий', issues, 'шт'))
  const len = g.layout === 'rowTop' ? W : H
  const end = clamp(g.end, [e, Math.max(e, len / 2)], 'От торца до крайнего отверстия', issues)
  const at = evenly(end, len - end, n)
  return g.layout === 'rowTop' ? at.map(cx => ({ cx, cy: e, d })) : at.map(cy => ({ cx: e, cy, d }))
}

function cutoutsOf(g: CutoutGroup, W: number, H: number, issues: DfmIssue[]): Seg[][] {
  const w = clamp(g.w, SPEC_LIMITS.cutSide, 'Ширина выреза', issues)
  const h = clamp(g.h, SPEC_LIMITS.cutSide, 'Высота выреза', issues)
  const r = limitRadius(Math.max(0, g.r), Math.min(w, h) / 2, 'Радиус углов выреза', issues)
  const n = Math.round(clamp(g.n, SPEC_LIMITS.cutN, 'Число вырезов', issues, 'шт'))
  const cy = clamp(g.fromTop, [0, H], 'От верхней кромки до центра выреза', issues)
  return Array.from({ length: n }, (_, i) => W * (i + 0.5) / n).map(cx => roundedRectSegs(cx - w / 2, cy - h / 2, w, h, [r, r, r, r]))
}

export function buildFromSpec(spec: PartSpec): PartGeometry {
  const issues: DfmIssue[] = []
  const lim = spec.shape === 'circle' ? SPEC_LIMITS.circle : spec.shape === 'ellipse' ? SPEC_LIMITS.ellipse : SPEC_LIMITS.side
  const W = clamp(spec.W, lim, spec.shape === 'circle' ? 'Диаметр' : 'Ширина', issues)
  const H = spec.shape === 'circle' ? W : clamp(spec.H, lim, 'Высота', issues)
  const { outer, label } = outerOf(spec, W, H, issues)
  const holes = spec.holes.flatMap(g => holesOf(g, W, H, issues))
  const cutouts = spec.cutouts.flatMap(g => cutoutsOf(g, W, H, issues))
  const title = SHAPES.find(s => s.id === spec.shape)?.title ?? 'Деталь'
  const size = spec.shape === 'circle' ? `Ø${numRu(W)}` : `${numRu(W)}×${numRu(H)}`
  const name = [`${title} ${size}`, label, holes.length ? `${holes.length} отв.` : '', cutouts.length ? `${cutouts.length} выр.` : ''].filter(Boolean).join(', ')
  return buildPart({ source: 'template', name, units: { detected: 'mm', applied: 'mm', factorToMm: 1 }, outer, holes, cutouts, issues })
}
