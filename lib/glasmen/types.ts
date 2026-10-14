export type Pt = { x: number; y: number }
export type BBox = { minX: number; minY: number; maxX: number; maxY: number }
export type DfmLevel = 'hard' | 'soft'          // hard = нельзя заказать, soft = предупреждение
export type DfmIssue = { code: string; level: DfmLevel; message: string; region?: BBox; at?: Pt }
export type HoleGeom = { cx: number; cy: number; d: number }

// Единицы чертежа, которые читаем из $INSUNITS и даём выбрать человеку.
export type DxfUnit = 'mm' | 'cm' | 'm' | 'inch' | 'ft'

// Круг крупнее — не отверстие под сверло, а круглый вырез (резка по контуру); тот же порог в API расчёта.
export const MAX_HOLE_D_MM = 100

// Отрезок контура в мм. Дуга задана центром, радиусом, начальным углом и
// знаковым углом развёртки (рад; > 0 — против часовой в математическом смысле
// текущей системы координат). В PartGeometry — система SVG (y вниз).
export type Seg =
  | { kind: 'line'; a: Pt; b: Pt }
  | { kind: 'arc'; c: Pt; r: number; a0: number; sweep: number }

export type CutoutGeom = {
  pathD: string; bbox: BBox; area: number; perimeter: number; minInnerRadius: number | null
  segs?: Seg[]                           // контур выреза для проверок DFM
}

export type PartGeometry = {
  source: 'dxf' | 'template'
  name: string
  units: { detected: DxfUnit | 'unknown'; applied: DxfUnit; factorToMm: number }   // applied — что подтвердил человек (или объявил файл)
  width: number; height: number          // габарит внешнего контура, мм (b-box, по нему считается цена м²)
  areaNet: number                        // м², фактическая площадь (внешний контур минус отверстия и вырезы)
  areaBBox: number                       // м², width×height
  perimeter: number                      // мм, длина внешнего контура (кромка)
  outerPathD: string                     // SVG path, мм, начало в (0,0) левый верх габарита
  holes: HoleGeom[]
  cutouts: CutoutGeom[]
  shape: 'rect' | 'curved'               // rect только если внешний контур — прямоугольник (допуск 0.5 мм, углы 90°); иначе curved
  cornerRadii?: number[]                 // если прямоугольник со скруглёнными углами: [ЛВ, ПВ, ПН, ЛН], 0 — острый угол
  issues: DfmIssue[]                     // проблемы разбора (незамкнутый контур и т.п.)
  outerSegs?: Seg[]                      // внешний контур отрезками — для проверок DFM и экспорта
  rotatedDeg?: number                    // повернули деталь к осям (прямоугольник, нарисованный под углом)
}

export type GlassCategory = 'glass' | 'mirror'

export type GlassRules = {               // правила стекла для толщины/обработки; числа — черновик, ждут технолога
  thickness: number; tempered: boolean
  minSide: number; maxLong: number; maxShort: number   // мм
  minHoleD: number                       // мин. диаметр отверстия
  minHoleEdge: number                    // мин. расстояние от края отверстия до кромки
  minHoleCorner: number                  // мин. расстояние от края отверстия до угла
  minHoleHole: number                    // мин. расстояние между краями отверстий
  minCutoutInnerRadius: number           // мин. внутренний радиус выреза
  minBridge: number                      // мин. перемычка между вырезом/отверстием и кромкой
  maxAreaM2?: number; maxWeightKg?: number
  category?: GlassCategory
  kgPerM2PerMm?: number                  // плотность для веса: кг на м² на мм толщины
}
