import type { BBox, DfmIssue, DfmLevel, GlassCategory, GlassRules, HoleGeom, PartGeometry, Pt, Seg } from './types'
import { distPtSegs, gapBetween, glassInnerCorners, numRu, outerCorners, parsePathD, pointInPoly, round, tessellate, dist } from './geom'

// черновик: числа ждут технолога
// Ориентиры — общая практика обработки закалённого стекла (EN 12150, правила
// подрядчиков по закалке): отверстие не тоньше стекла, отступы в толщинах стекла.
export const DFM_DRAFT = {
  holeDPerT: 1,              // Ø отверстия ≥ 1 толщины
  holeDMin: 5,               // и не меньше 5 мм — тоньше сверло в стекле ломается
  holeEdgePerT: 2,           // край отверстия → кромка ≥ 2 толщины
  holeCornerPerT: 6.5,       // край отверстия → угол ≥ 6,5 толщины
  holeHolePerT: 2,           // край → край соседних отверстий ≥ 2 толщины
  cutoutRadiusPerT: 1,       // внутренний радиус выреза ≥ толщины
  cutoutRadiusMin: 5,        // и не меньше 5 мм
  bridgePerT: 3,             // перемычка у выреза ≥ 3 толщины
  bridgeMin: 15,             // и не меньше 15 мм
  minSideTempered: 100,      // меньшую деталь печь не держит
  minSideAnnealed: 30,
  furnace: { maxLong: 3600, maxShort: 2440 },   // печь закалки
  sheet: { maxLong: 6000, maxShort: 3210 },     // лист стекла (джамбо)
  kgPerM2PerMm: 2.5,
  maxWeightKg: 80,           // тяжелее — монтаж и доставка бригадой
} as const

export type GlassRulesOptions = {
  category?: GlassCategory
  furnace?: { maxLong: number; maxShort: number }
  sheet?: { maxLong: number; maxShort: number }
}

export function glassRules(thickness: number, tempered: boolean, opts: GlassRulesOptions = {}): GlassRules {
  const t = thickness
  const category = opts.category ?? 'glass'
  const isTempered = tempered && category !== 'mirror'
  const size = isTempered ? (opts.furnace ?? DFM_DRAFT.furnace) : (opts.sheet ?? DFM_DRAFT.sheet)
  return {
    thickness: t,
    tempered: isTempered,
    category,
    minSide: isTempered ? DFM_DRAFT.minSideTempered : DFM_DRAFT.minSideAnnealed,
    maxLong: size.maxLong,
    maxShort: size.maxShort,
    minHoleD: Math.max(t * DFM_DRAFT.holeDPerT, DFM_DRAFT.holeDMin),
    minHoleEdge: DFM_DRAFT.holeEdgePerT * t,
    minHoleCorner: DFM_DRAFT.holeCornerPerT * t,
    minHoleHole: DFM_DRAFT.holeHolePerT * t,
    minCutoutInnerRadius: Math.max(DFM_DRAFT.cutoutRadiusPerT * t, DFM_DRAFT.cutoutRadiusMin),
    minBridge: Math.max(DFM_DRAFT.bridgePerT * t, DFM_DRAFT.bridgeMin),
    maxWeightKg: DFM_DRAFT.maxWeightKg,
    kgPerM2PerMm: DFM_DRAFT.kgPerM2PerMm,
  }
}

const holeBox = (h: HoleGeom, pad = 0): BBox => {
  const r = h.d / 2 + pad
  return { minX: round(h.cx - r), minY: round(h.cy - r), maxX: round(h.cx + r), maxY: round(h.cy + r) }
}
const around = (p: Pt, r: number): BBox => ({ minX: round(p.x - r), minY: round(p.y - r), maxX: round(p.x + r), maxY: round(p.y + r) })
const atPt = (p: Pt): Pt => ({ x: round(p.x), y: round(p.y) })
const n1 = (x: number) => numRu(x, 1)

export function checkDfm(geom: PartGeometry, rules: GlassRules): DfmIssue[] {
  const out: DfmIssue[] = []
  if (!geom.outerPathD || geom.perimeter <= 0 || geom.width <= 0 || geom.height <= 0) return out
  const outer: Seg[] = geom.outerSegs ?? parsePathD(geom.outerPathD)
  if (!outer.length) return out
  const outerPoly = tessellate(outer, true, 0.05)
  const t = rules.thickness
  const strict: DfmLevel = rules.tempered ? 'hard' : 'soft'
  const glass = rules.category === 'mirror' ? 'зеркала' : 'стекла'
  const kind = rules.tempered ? `закалённого ${glass} ${n1(t)} мм` : `${glass} ${n1(t)} мм без закалки`
  const why = rules.tempered ? 'стекло лопнет при закалке' : 'риск скола при обработке'
  const whole: BBox = { minX: 0, minY: 0, maxX: geom.width, maxY: geom.height }

  const long = Math.max(geom.width, geom.height), short = Math.min(geom.width, geom.height)
  if (short < rules.minSide) {
    out.push({ code: 'too_small', level: 'hard', region: whole, message: `Сторона ${n1(short)} мм меньше минимальной ${n1(rules.minSide)} мм для ${kind}.` })
  }
  if (long > rules.maxLong || short > rules.maxShort) {
    out.push(rules.tempered
      ? { code: 'too_large_for_tempering', level: 'hard', region: whole, message: `Деталь ${n1(long)}×${n1(short)} мм не входит в печь закалки: максимум ${n1(rules.maxLong)}×${n1(rules.maxShort)} мм.` }
      : { code: 'too_large', level: 'hard', region: whole, message: `Деталь ${n1(long)}×${n1(short)} мм больше листа ${glass}: максимум ${n1(rules.maxLong)}×${n1(rules.maxShort)} мм.` })
  }
  if (rules.maxAreaM2 !== undefined && geom.areaBBox > rules.maxAreaM2) {
    out.push({ code: 'too_large', level: 'hard', region: whole, message: `Площадь ${numRu(geom.areaBBox, 2)} м² больше предельной ${numRu(rules.maxAreaM2, 2)} м².` })
  }
  const weight = geom.areaNet * t * (rules.kgPerM2PerMm ?? DFM_DRAFT.kgPerM2PerMm)
  if (rules.maxWeightKg !== undefined && weight > rules.maxWeightKg) {
    out.push({ code: 'heavy_part', level: 'soft', region: whole, message: `Деталь весит около ${numRu(weight, 0)} кг — больше ${numRu(rules.maxWeightKg, 0)} кг: доставка и монтаж бригадой, фурнитура под такой вес.` })
  }

  const corners = outerCorners(outer)
  const cutSegs = geom.cutouts.map(c => c.segs ?? parsePathD(c.pathD))

  geom.holes.forEach((h, i) => {
    const r = h.d / 2
    const c = { x: h.cx, y: h.cy }
    const toEdge = distPtSegs(c, outer).d - r
    if (!pointInPoly(c, outerPoly) || toEdge < 0) {
      out.push({ code: 'contours_intersect', level: 'hard', region: holeBox(h), at: atPt(c), message: `Отверстие Ø${n1(h.d)} мм выходит за кромку детали.` })
      return
    }
    if (h.d < rules.minHoleD) {
      const reason = h.d < t
        ? (rules.tempered ? `меньше толщины ${glass} ${n1(t)} мм: при закалке стекло лопнет` : `меньше толщины ${glass} ${n1(t)} мм: риск скола при сверлении`)
        : `слишком маленькое: сверло тоньше ${n1(DFM_DRAFT.holeDMin)} мм ломается в стекле`
      out.push({ code: 'hole_too_small', level: strict, region: holeBox(h, 2), at: atPt(c), message: `Отверстие Ø${n1(h.d)} мм ${reason}. Минимум — Ø${n1(rules.minHoleD)} мм.` })
    }
    if (toEdge < rules.minHoleEdge) {
      out.push({ code: 'hole_too_close_edge', level: strict, region: holeBox(h, rules.minHoleEdge), at: atPt(c), message: `Край отверстия Ø${n1(h.d)} мм в ${n1(toEdge)} мм от кромки, нужно не меньше ${n1(rules.minHoleEdge)} мм (${n1(DFM_DRAFT.holeEdgePerT)} толщины ${glass}): ${why}.` })
    }
    let nearCorner: { d: number; p: Pt } | null = null
    for (const k of corners) {
      const d = dist(c, k) - r
      if (!nearCorner || d < nearCorner.d) nearCorner = { d, p: k }
    }
    if (nearCorner && nearCorner.d < rules.minHoleCorner) {
      out.push({ code: 'hole_too_close_corner', level: strict, region: around(nearCorner.p, rules.minHoleCorner), at: atPt(c), message: `Край отверстия Ø${n1(h.d)} мм в ${n1(nearCorner.d)} мм от угла, нужно не меньше ${n1(rules.minHoleCorner)} мм (${n1(DFM_DRAFT.holeCornerPerT)} толщины ${glass}): ${why}.` })
    }
    for (let j = i + 1; j < geom.holes.length; j++) {
      const g = geom.holes[j]
      const gap = dist(c, { x: g.cx, y: g.cy }) - r - g.d / 2
      if (gap < rules.minHoleHole) {
        const mid = { x: (h.cx + g.cx) / 2, y: (h.cy + g.cy) / 2 }
        out.push({
          code: 'holes_too_close', level: strict, at: atPt(mid),
          region: { minX: round(Math.min(h.cx - r, g.cx - g.d / 2)), minY: round(Math.min(h.cy - r, g.cy - g.d / 2)), maxX: round(Math.max(h.cx + r, g.cx + g.d / 2)), maxY: round(Math.max(h.cy + r, g.cy + g.d / 2)) },
          message: `Между краями отверстий ${n1(Math.max(0, gap))} мм, нужно не меньше ${n1(rules.minHoleHole)} мм (${n1(DFM_DRAFT.holeHolePerT)} толщины ${glass}): ${why}.`,
        })
      }
    }
    cutSegs.forEach(cs => {
      const gap = distPtSegs(c, cs).d - r
      if (gap < rules.minBridge) {
        out.push({ code: 'narrow_bridge', level: strict, region: holeBox(h, rules.minBridge), at: atPt(c), message: `Перемычка между отверстием Ø${n1(h.d)} мм и вырезом ${n1(Math.max(0, gap))} мм, нужно не меньше ${n1(rules.minBridge)} мм: ${why}.` })
      }
    })
  })

  cutSegs.forEach((cs, i) => {
    const cbox = geom.cutouts[i].bbox
    const poly = tessellate(cs, true, 0.05)
    if (poly.some(p => !pointInPoly(p, outerPoly))) {
      out.push({ code: 'contours_intersect', level: 'hard', region: cbox, message: 'Вырез выходит за кромку детали.' })
      return
    }
    out.push(...sharpCornerIssues(cs, true, rules, strict, why))
    const edge = gapBetween(cs, outer)
    if (edge.d < rules.minBridge) {
      out.push({ code: 'narrow_bridge', level: strict, region: around(edge.at, rules.minBridge), at: atPt(edge.at), message: `Перемычка между вырезом и кромкой ${n1(edge.d)} мм, нужно не меньше ${n1(rules.minBridge)} мм: ${why}.` })
    }
    for (let j = i + 1; j < cutSegs.length; j++) {
      const g = gapBetween(cs, cutSegs[j])
      if (g.d < rules.minBridge) {
        out.push({ code: 'narrow_bridge', level: strict, region: around(g.at, rules.minBridge), at: atPt(g.at), message: `Перемычка между вырезами ${n1(g.d)} мм, нужно не меньше ${n1(rules.minBridge)} мм: ${why}.` })
      }
    }
  })

  out.push(...sharpCornerIssues(outer, false, rules, strict, why))
  return out
}

function sharpCornerIssues(segs: Seg[], isCutout: boolean, rules: GlassRules, level: DfmLevel, why: string): DfmIssue[] {
  const { sharp, arcs } = glassInnerCorners(segs, isCutout)
  const where = isCutout ? 'выреза' : 'на контуре детали'
  const need = `Нужен радиус не меньше R${n1(rules.minCutoutInnerRadius)} мм`
  const out: DfmIssue[] = []
  if (sharp.length) {
    out.push({
      code: 'cutout_sharp_corner', level, at: atPt(sharp[0]), region: around(sharp[0], rules.minCutoutInnerRadius * 2),
      message: `Острый внутренний угол ${where}${sharp.length > 1 ? ` (${sharp.length} шт.)` : ''}: ${why}. ${need}.`,
    })
  }
  const small = arcs.filter(a => a.r < rules.minCutoutInnerRadius - 1e-6)
  if (small.length) {
    const worst = small.reduce((a, b) => (b.r < a.r ? b : a))
    out.push({
      code: 'cutout_sharp_corner', level, at: atPt(worst.at), region: around(worst.at, rules.minCutoutInnerRadius * 2),
      message: `Внутренний радиус ${where} R${n1(worst.r)} мм меньше допустимого: ${why}. ${need}.`,
    })
  }
  return out
}

export const hasHardIssues = (issues: DfmIssue[]) => issues.some(i => i.level === 'hard')

export function allIssues(geom: PartGeometry, rules: GlassRules): DfmIssue[] {
  return [...geom.issues, ...checkDfm(geom, rules)]
}
