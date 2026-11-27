import { point, type Range } from '../classification/vat'
import type { EdgeMode, Marking, PartSpec, SandMode } from '../engine/technology'
import type { AreaScenario, LeaseScenario } from '../engine/rates'

// Экспериментальный проект лаборатории. Это не заказ: он не попадает в производство, на склад,
// в выручку и в статистику. Хранится отдельно от заказов и сохранённых расчётов.
export const SHEET_W = 3210
export const SHEET_H = 2250

export type CutoutEquipment = 'jym' | 'manual' | 'unknown'
export type MaterialMode =
  | { kind: 'utilization'; coefficient: number | null }        // А: расход = годная площадь ÷ коэффициент
  | { kind: 'sheets'; partsPerSheet: number | null }           // Б: целые листы по размещению деталей
  | { kind: 'manual'; m2: number | null }                      // В: фактический расход введён руками

export type LabExtra = { label: string; amountGross: number; vat: number | 'none' | 'unknown' }

export type LabPosition = {
  id: string
  materialId: number | null
  materialLabel?: string
  thicknessMm: number | null
  widthMm: number | null
  heightMm: number | null
  shape: 'rect' | 'curved'
  qty: number
  edge: EdgeMode
  edgeSides: number | null          // сколько сторон обрабатывается (1…4); null → весь периметр
  edgeLengthM: number | null        // длина обработки на деталь, если она задана прямо
  holes: { diameterMm: number | null; perPart: number }[]
  marking: Marking
  cutouts: { type: string | null; perPart: number; equipment: CutoutEquipment }[]
  sandblast: { m2PerPart: number | null; mode: SandMode } | null
  tempering: boolean
  triplexLayers: number | null      // 2 или 3 стекла в пакете
  facet: boolean
  packaging: boolean
  material: MaterialMode
  extras: LabExtra[]
}

export type LabScenario = {
  area: AreaScenario
  leases: LeaseScenario
  shifts: number
  vatRatePct: number                // ставка исходящего НДС проекта
  commissionPct: number             // комиссия от цены с НДС
  targetMarginPct: number | null    // целевая доля МД (сценарий В)
  targetMdPerHour: number | null    // целевой МД на час ресурса (сценарий Г)
  channel: 'b2b' | 'd2c' | 'b2c' | 'internal'
  profile: 'detailed' | 'with_coarse'
  deductInputVat: boolean           // есть ли право на вычет входного НДС
}

export type LabOverride = { key: string; lo: number; hi: number; note: string }

export type LabProject = {
  id?: string
  title: string
  note: string
  scenario: LabScenario
  overrides: LabOverride[]          // правка норматива только этого проекта
  positions: LabPosition[]
}

export const DEFAULT_SCENARIO: LabScenario = {
  area: 'target', leases: 'active', shifts: 1, vatRatePct: 22, commissionPct: 0,
  targetMarginPct: null, targetMdPerHour: null, channel: 'b2b', profile: 'detailed', deductInputVat: true,
}

export const emptyPosition = (id: string): LabPosition => ({
  id, materialId: null, thicknessMm: null, widthMm: null, heightMm: null, shape: 'rect', qty: 1,
  edge: 'unknown', edgeSides: null, edgeLengthM: null, holes: [], marking: 'unknown', cutouts: [],
  sandblast: null, tempering: false, triplexLayers: null, facet: false, packaging: true,
  material: { kind: 'utilization', coefficient: null }, extras: [],
})

export const areaM2 = (p: LabPosition) => (p.widthMm && p.heightMm ? p.widthMm * p.heightMm / 1_000_000 : 0)
export const perimeterM = (p: LabPosition) => (p.widthMm && p.heightMm ? 2 * (p.widthMm + p.heightMm) / 1000 : 0)
export const layersOf = (p: LabPosition) => (p.triplexLayers === 3 ? 3 : p.triplexLayers === 2 ? 2 : 1)
export const weightKg = (p: LabPosition, kgPerM2PerMm: number) =>
  (p.thicknessMm ? areaM2(p) * p.qty * p.thicknessMm * kgPerM2PerMm * layersOf(p) : 0)

// Длина обработки кромки на деталь. Задана прямо — берём её; задано число сторон — считаем по
// габариту прямоугольника (одна сторона = большая, две = большая + меньшая); иначе весь периметр.
export function edgeMetresPerPart(p: LabPosition): number | null {
  if (p.edgeLengthM != null) return p.edgeLengthM
  if (p.edgeSides == null || !p.widthMm || !p.heightMm) return null
  const a = Math.max(p.widthMm, p.heightMm) / 1000, b = Math.min(p.widthMm, p.heightMm) / 1000
  const sides = Math.max(0, Math.min(4, Math.round(p.edgeSides)))
  return [0, a, a + b, 2 * a + b, 2 * (a + b)][sides]
}

export function toSpec(p: LabPosition, sheets: Range | null): PartSpec {
  return {
    key: p.id,
    materialKey: p.materialId == null ? null : String(p.materialId),
    thicknessMm: p.thicknessMm, widthMm: p.widthMm, heightMm: p.heightMm,
    qty: p.qty, layers: layersOf(p), shape: p.shape,
    edge: p.edge, edgeMetresPerPart: edgeMetresPerPart(p), sheets,
    holes: p.holes.filter(h => h.perPart > 0), marking: p.marking,
    cutouts: p.cutouts.filter(x => x.perPart > 0),
    tempering: p.tempering,
    sandblast: p.sandblast, packaging: p.packaging,
  }
}

export function projectErrors(pr: LabProject): string[] {
  const e: string[] = []
  if (!pr.title.trim()) e.push('Нет названия проекта')
  if (!pr.positions.length) e.push('В проекте нет позиций')
  pr.positions.forEach((p, i) => {
    const at = `позиция ${i + 1}`
    if (!(p.qty > 0)) e.push(`${at}: количество должно быть больше нуля`)
    if (p.widthMm != null && p.widthMm <= 0) e.push(`${at}: ширина`)
    if (p.heightMm != null && p.heightMm <= 0) e.push(`${at}: высота`)
    if (p.material.kind === 'utilization' && p.material.coefficient != null
      && !(p.material.coefficient > 0 && p.material.coefficient <= 1)) {
      e.push(`${at}: коэффициент использования материала — доля от 0 до 1, а не процент надбавки на отход`)
    }
    if (p.material.kind === 'sheets' && p.material.partsPerSheet != null && !(p.material.partsPerSheet > 0)) {
      e.push(`${at}: деталей на листе`)
    }
  })
  const s = pr.scenario
  if (!(s.vatRatePct >= 0)) e.push('Ставка НДС')
  if (!(s.commissionPct >= 0 && s.commissionPct < 100)) e.push('Комиссия — процент от цены с НДС')
  if (s.targetMarginPct != null && !(s.targetMarginPct >= 0 && s.targetMarginPct < 100)) e.push('Целевая маржинальность')
  if (!(s.shifts >= 1)) e.push('Смены')
  return e
}

export const asRange = (o: LabOverride): Range => (o.lo === o.hi ? point(o.lo) : { lo: o.lo, hi: o.hi })
