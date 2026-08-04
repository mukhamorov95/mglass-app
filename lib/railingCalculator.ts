// Просчёт лестничных и прямых стеклянных ограждений: пролёт + ступени → заготовки
// стекла → расход листа. Раскрой считает существующий движок computeMaterialUsage
// (гильотинная укладка заготовок в лист + честный разбор на нетто/рез/остаток).
//
// Геометрия наклонного полотна (лестница). Стекло идёт по скату: верх и низ
// параллельны линии ступеней, боковые кромки вертикальные — это параллелограмм.
//   tg θ  = подступёнок / проступь              (угол ската)
//   нетто = ширина × высота                     (скос площадь не меняет)
//   заготовка = ширина × (высота + ширина·tg θ) (сверху/снизу — треугольный обрез ската)
// Прямое ограждение (терраса, балкон) — обычный прямоугольник, скоса нет.

import {
  computeMaterialUsage, sumUsage, DEFAULT_SHEET,
  type UsageItem, type MaterialUsage, type UsageTotals,
} from './materialUsage'
import { DEFAULT_CUTTING_SETTINGS, type CuttingSettings } from './cuttingOptimizer'

export type RailingShape = 'raked' | 'rectangular'          // наклонное (лестница) | прямое
export type RailingFixing = 'points' | 'posts' | 'profile'  // точки | стойки | зажимной профиль

// Стандартная ступень объекта (по замеру: проступь 297, подступёнок 180 мм).
export const STANDARD_STEP = { tread: 297, riser: 180 }

// Заход стекла в нижнее крепление, мм. Для точек/стоек стекло держится сквозными
// точками — низ не утапливается; для зажимного профиля стекло заходит внутрь.
const BOTTOM_ALLOWANCE: Record<RailingFixing, number> = {
  points: 0,
  posts: 0,
  profile: 25,
}

export type StepGeometry = { tread: number; riser: number }

export type RailingSegment = {
  name: string
  // Для лестницы — горизонтальная проекция пролёта (сумма проступей).
  // Для прямого ограждения — просто длина участка.
  spanMm: number
  shape: RailingShape
  steps?: number  // если не задано — округляем span/проступь
}

export type RailingParams = {
  heightMm: number            // вертикальная высота ограждения (край ступени → верх стекла)
  thicknessMm: number
  materialName: string
  fixing: RailingFixing
  maxPanelWidthMm: number      // макс. ширина одного полотна (делёж пролёта на стёкла)
  step: StepGeometry
  sheet?: { width: number; height: number }
  costPerM2?: number
  reuseRate?: number           // доля возвратного остатка (см. materialUsage)
  cutting?: CuttingSettings
}

export type Slope = { tan: number; angleDeg: number; factor: number }

export function slopeOf(step: StepGeometry): Slope {
  const tan = step.riser / step.tread
  return {
    tan,
    angleDeg: Math.round((Math.atan(tan) * 180) / Math.PI * 10) / 10,
    factor: Math.hypot(step.tread, step.riser) / step.tread,  // наклонная длина / горизонталь
  }
}

export type Panel = {
  widthMm: number      // ширина полотна (горизонтальная проекция)
  blankW: number       // прямоугольная заготовка, ширина
  blankH: number       // прямоугольная заготовка, высота (с учётом скоса и захода)
  netAreaMm2: number   // чистое стекло в изделии
  blankAreaMm2: number // площадь заготовки (нетто + треугольный обрез ската)
}

export type SegmentResult = {
  name: string
  shape: RailingShape
  spanMm: number
  steps: number
  panelCount: number
  panelWidthMm: number
  alongSlopeMm: number   // длина стекла по скату (погонаж наклонной кромки)
  netM2: number
  blankM2: number
  rakedWasteM2: number   // треугольный обрез ската (blank − net)
  panels: Panel[]
}

const M2 = (mm2: number) => mm2 / 1_000_000
const r1 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100

function panelize(seg: RailingSegment, p: RailingParams): SegmentResult {
  const slope = slopeOf(p.step)
  const steps = seg.steps ?? Math.max(1, Math.round(seg.spanMm / p.step.tread))
  const panelCount = Math.max(1, Math.ceil(seg.spanMm / p.maxPanelWidthMm))
  const panelWidthMm = seg.spanMm / panelCount

  // Полная высота стекла = видимая высота + заход в нижнее крепление.
  const glassH = p.heightMm + BOTTOM_ALLOWANCE[p.fixing]

  const panels: Panel[] = Array.from({ length: panelCount }, () => {
    const netAreaMm2 = panelWidthMm * glassH
    // Наклонное полотно — параллелограмм: заготовка выше на скос ширины полотна.
    const blankH = seg.shape === 'raked'
      ? glassH + panelWidthMm * slope.tan
      : glassH
    const blankW = panelWidthMm
    return {
      widthMm: r1(panelWidthMm),
      blankW: Math.round(blankW),
      blankH: Math.round(blankH),
      netAreaMm2,
      blankAreaMm2: blankW * blankH,
    }
  })

  const netMm2 = panels.reduce((s, x) => s + x.netAreaMm2, 0)
  const blankMm2 = panels.reduce((s, x) => s + x.blankAreaMm2, 0)
  const alongSlopeMm = seg.shape === 'raked' ? seg.spanMm * slope.factor : seg.spanMm

  return {
    name: seg.name,
    shape: seg.shape,
    spanMm: seg.spanMm,
    steps,
    panelCount,
    panelWidthMm: r1(panelWidthMm),
    alongSlopeMm: Math.round(alongSlopeMm),
    netM2: r2(M2(netMm2)),
    blankM2: r2(M2(blankMm2)),
    rakedWasteM2: r2(M2(blankMm2 - netMm2)),
    panels,
  }
}

export type RailingResult = {
  slope: Slope
  segments: SegmentResult[]
  // Погонаж
  spanTotalM: number         // сумма пролётов (горизонталь)
  alongSlopeTotalM: number   // сумма длин по скату
  // Площади
  netM2: number              // чистое стекло в изделиях
  blankM2: number            // прямоугольные заготовки (нетто + обрез ската)
  rakedWasteM2: number       // треугольный обрез ската
  // Расход листа (движок computeMaterialUsage по прямоугольным заготовкам)
  usage: MaterialUsage[]
  totals: UsageTotals
  sheetsNeeded: number
  sheet: { width: number; height: number }
  // Удельные коэффициенты «на погонный метр» (горизонтальный)
  perMeter: {
    stepsPerM: number        // ступеней на 1 пог. м пролёта
    netM2PerM: number        // чистого стекла, м²/пог.м
    blankM2PerM: number      // заготовок, м²/пог.м
    alongSlopePerM: number   // м стекла по скату на 1 пог. м пролёта
  }
}

export function computeRailing(segments: RailingSegment[], p: RailingParams): RailingResult {
  const slope = slopeOf(p.step)
  const sheet = p.sheet ?? DEFAULT_SHEET
  const segResults = segments.map(s => panelize(s, p))

  // Все заготовки одного материала/толщины кроятся вместе — как в реальном раскрое.
  const items: UsageItem[] = []
  for (const s of segResults) {
    for (const pan of s.panels) {
      items.push({
        materialName: p.materialName,
        thickness: p.thicknessMm,
        category: 'glass',
        width: pan.blankW,
        height: pan.blankH,
        quantity: 1,
        costPerM2: p.costPerM2 ?? 0,
        sheetWidth: sheet.width,
        sheetHeight: sheet.height,
      })
    }
  }

  const usage = computeMaterialUsage(items, p.reuseRate, p.cutting ?? DEFAULT_CUTTING_SETTINGS)
  const totals = sumUsage(usage)
  const sheetsNeeded = usage.reduce((s, u) => s + u.sheets, 0)

  const spanTotalMm = segResults.reduce((s, x) => s + x.spanMm, 0)
  const alongSlopeTotalMm = segResults.reduce((s, x) => s + x.alongSlopeMm, 0)
  const netM2 = segResults.reduce((s, x) => s + x.netM2, 0)
  const blankM2 = segResults.reduce((s, x) => s + x.blankM2, 0)
  const spanTotalM = spanTotalMm / 1000

  return {
    slope,
    segments: segResults,
    spanTotalM: r2(spanTotalM),
    alongSlopeTotalM: r2(alongSlopeTotalMm / 1000),
    netM2: r2(netM2),
    blankM2: r2(blankM2),
    rakedWasteM2: r2(blankM2 - netM2),
    usage,
    totals,
    sheetsNeeded,
    sheet,
    perMeter: {
      stepsPerM: r2(1000 / p.step.tread),
      netM2PerM: spanTotalM > 0 ? r2(netM2 / spanTotalM) : 0,
      blankM2PerM: spanTotalM > 0 ? r2(blankM2 / spanTotalM) : 0,
      alongSlopePerM: r2(slope.factor),
    },
  }
}
