import { describe, it, expect } from 'vitest'
import { checkDfm, glassRules, hasHardIssues, allIssues, DFM_DRAFT } from '@/lib/glasmen/rules'
import { getTemplate } from '@/lib/glasmen/templates'
import { parseDxf } from '@/lib/glasmen/dxf'
import { dxf, lw, rectLw, circ } from './fixtures'
import type { DfmIssue, PartGeometry } from '@/lib/glasmen/types'

const rect = (W: number, H: number) => parseDxf(dxf([rectLw(0, 0, W, H)]))
const holeAt = (W: number, H: number, holes: { cx: number; cy: number; d: number }[]): PartGeometry => ({ ...rect(W, H), holes })
const of = (issues: DfmIssue[], code: string) => issues.filter(i => i.code === code)

const T6 = glassRules(6, true)
const A6 = glassRules(6, false)

describe('glassRules — черновые числа', () => {
  it('закалённое 6 мм', () => {
    expect(T6).toMatchObject({
      thickness: 6, tempered: true, category: 'glass',
      minSide: 100, maxLong: 3600, maxShort: 2440,
      minHoleD: 6, minHoleEdge: 12, minHoleCorner: 39, minHoleHole: 12,
      minCutoutInnerRadius: 6, minBridge: 18, maxWeightKg: 80,
    })
  })
  it('тонкое стекло: Ø и радиус не меньше 5 мм, перемычка не меньше 15 мм', () => {
    const r = glassRules(4, true)
    expect(r.minHoleD).toBe(5)
    expect(r.minCutoutInnerRadius).toBe(5)
    expect(r.minBridge).toBe(15)
  })
  it('без закалки — размер листа и мин. сторона 30 мм', () => {
    expect(A6).toMatchObject({ tempered: false, minSide: 30, maxLong: 6000, maxShort: 3210 })
  })
  it('зеркало не закаливается, даже если попросили', () => {
    const m = glassRules(4, true, { category: 'mirror' })
    expect(m.tempered).toBe(false)
    expect(m.category).toBe('mirror')
  })
  it('печь задаётся параметром', () => {
    expect(glassRules(8, true, { furnace: { maxLong: 3000, maxShort: 2000 } })).toMatchObject({ maxLong: 3000, maxShort: 2000 })
  })
  it('константы черновика экспортируются для показа «ждёт технолога»', () => {
    expect(DFM_DRAFT.holeCornerPerT).toBe(6.5)
  })
})

describe('checkDfm — габариты', () => {
  it('too_small: 100 мм проходит, 99 — нет (закалка)', () => {
    expect(of(checkDfm(rect(100, 500), T6), 'too_small')).toHaveLength(0)
    const iss = of(checkDfm(rect(99, 500), T6), 'too_small')
    expect(iss).toHaveLength(1)
    expect(iss[0].level).toBe('hard')
  })
  it('too_small без закалки: 30 проходит, 29 — нет', () => {
    expect(of(checkDfm(rect(30, 500), A6), 'too_small')).toHaveLength(0)
    expect(of(checkDfm(rect(29, 500), A6), 'too_small')[0].level).toBe('hard')
  })
  it('too_large_for_tempering: 3600×2440 проходит, 3601 или 2441×2441 — нет', () => {
    expect(of(checkDfm(rect(3600, 2440), T6), 'too_large_for_tempering')).toHaveLength(0)
    expect(of(checkDfm(rect(2000, 3601), T6), 'too_large_for_tempering')[0].level).toBe('hard')
    const i = of(checkDfm(rect(2441, 2441), T6), 'too_large_for_tempering')[0]
    expect(i.level).toBe('hard')
    expect(i.message).toMatch(/печь закалки/)
    expect(i.message).toMatch(/3600×2440/)
    expect(of(checkDfm(rect(2441, 2000), T6), 'too_large_for_tempering')).toHaveLength(0)
  })
  it('без закалки предел — лист: 3601 проходит, 6000×3211 — too_large', () => {
    expect(checkDfm(rect(3601, 2000), A6).filter(i => i.level === 'hard')).toHaveLength(0)
    expect(of(checkDfm(rect(6000, 3211), A6), 'too_large')[0].level).toBe('hard')
  })
  it('heavy_part: 80 кг — ещё нет, 100 кг — soft', () => {
    const r10 = glassRules(10, true)
    expect(of(checkDfm(rect(1600, 2000), r10), 'heavy_part')).toHaveLength(0)
    const i = of(checkDfm(rect(2000, 2000), r10), 'heavy_part')
    expect(i).toHaveLength(1)
    expect(i[0].level).toBe('soft')
    expect(i[0].message).toMatch(/100 кг/)
  })
})

describe('checkDfm — отверстия', () => {
  it('hole_too_small: Ø6 при 6 мм проходит, Ø5,5 — hard с понятным текстом', () => {
    expect(of(checkDfm(holeAt(1000, 600, [{ cx: 500, cy: 300, d: 6 }]), T6), 'hole_too_small')).toHaveLength(0)
    const iss = checkDfm(holeAt(1000, 600, [{ cx: 500, cy: 300, d: 5.5 }]), T6)
    const i = iss.find(x => x.code === 'hole_too_small')!
    expect(i.level).toBe('hard')
    expect(i.message).toBe('Отверстие Ø5,5 мм меньше толщины стекла 6 мм: при закалке стекло лопнет. Минимум — Ø6 мм.')
    expect(i.at).toEqual({ x: 500, y: 300 })
    expect(i.region).toBeDefined()
  })
  it('hole_too_small без закалки — soft', () => {
    expect(of(checkDfm(holeAt(1000, 600, [{ cx: 500, cy: 300, d: 5.5 }]), A6), 'hole_too_small')[0].level).toBe('soft')
  })
  it('hole_too_small на тонком стекле — про минимум сверла', () => {
    const i = of(checkDfm(holeAt(1000, 600, [{ cx: 500, cy: 300, d: 4.5 }]), glassRules(4, true)), 'hole_too_small')[0]
    expect(i.message).toMatch(/сверло/)
    expect(i.message).toMatch(/Ø5 мм/)
  })
  it('hole_too_close_edge: 12 мм проходит, 11,9 — hard', () => {
    expect(of(checkDfm(holeAt(1000, 600, [{ cx: 17, cy: 300, d: 10 }]), T6), 'hole_too_close_edge')).toHaveLength(0)
    const i = of(checkDfm(holeAt(1000, 600, [{ cx: 16.9, cy: 300, d: 10 }]), T6), 'hole_too_close_edge')
    expect(i).toHaveLength(1)
    expect(i[0].level).toBe('hard')
    expect(i[0].message).toMatch(/11,9 мм от кромки, нужно не меньше 12 мм/)
    expect(of(checkDfm(holeAt(1000, 600, [{ cx: 16.9, cy: 300, d: 10 }]), A6), 'hole_too_close_edge')[0].level).toBe('soft')
  })
  it('hole_too_close_corner: 39 мм от угла проходит, меньше — hard', () => {
    // край отверстия до угла = a·√2 − r
    expect(of(checkDfm(holeAt(1000, 600, [{ cx: 31.2, cy: 31.2, d: 10 }]), T6), 'hole_too_close_corner')).toHaveLength(0)
    const i = of(checkDfm(holeAt(1000, 600, [{ cx: 31, cy: 31, d: 10 }]), T6), 'hole_too_close_corner')
    expect(i).toHaveLength(1)
    expect(i[0].level).toBe('hard')
    expect(i[0].message).toMatch(/от угла, нужно не меньше 39 мм/)
  })
  it('holes_too_close: 12 мм между краями проходит, 11,9 — hard', () => {
    const ok = checkDfm(holeAt(1000, 600, [{ cx: 500, cy: 300, d: 10 }, { cx: 522, cy: 300, d: 10 }]), T6)
    expect(of(ok, 'holes_too_close')).toHaveLength(0)
    const bad = of(checkDfm(holeAt(1000, 600, [{ cx: 500, cy: 300, d: 10 }, { cx: 521.9, cy: 300, d: 10 }]), T6), 'holes_too_close')
    expect(bad).toHaveLength(1)
    expect(bad[0].level).toBe('hard')
  })
  it('отверстие за кромкой → contours_intersect', () => {
    expect(of(checkDfm(holeAt(1000, 600, [{ cx: 1200, cy: 300, d: 10 }]), T6), 'contours_intersect')).toHaveLength(1)
  })
})

describe('checkDfm — вырезы и перемычки', () => {
  const sb = (p: Record<string, number>) => getTemplate('splashback')!.build({ W: 2000, H: 600, sockets: 1, s1W: 75, s1H: 75, s1R: 8, s1X: 400, s1Y: 300, ...p })

  it('cutout_sharp_corner: R6 при 6 мм проходит, R5,9 — hard, без закалки — soft', () => {
    expect(of(checkDfm(sb({ s1R: 6 }), T6), 'cutout_sharp_corner')).toHaveLength(0)
    const i = of(checkDfm(sb({ s1R: 5.9 }), T6), 'cutout_sharp_corner')
    expect(i).toHaveLength(1)
    expect(i[0].level).toBe('hard')
    expect(i[0].message).toMatch(/R5,9 мм/)
    expect(of(checkDfm(sb({ s1R: 5.9 }), A6), 'cutout_sharp_corner')[0].level).toBe('soft')
  })
  it('острый угол выреза (R0) → cutout_sharp_corner, 4 угла в одном замечании', () => {
    const i = of(checkDfm(sb({ s1R: 0 }), T6), 'cutout_sharp_corner')
    expect(i).toHaveLength(1)
    expect(i[0].message).toMatch(/Острый внутренний угол выреза \(4 шт\.\)/)
  })
  it('narrow_bridge: вырез в 18 мм от кромки проходит, 17,9 — hard', () => {
    expect(of(checkDfm(sb({ s1X: 18 + 37.5 }), T6), 'narrow_bridge')).toHaveLength(0)
    const i = of(checkDfm(sb({ s1X: 17.9 + 37.5 }), T6), 'narrow_bridge')
    expect(i).toHaveLength(1)
    expect(i[0].level).toBe('hard')
    expect(i[0].message).toMatch(/17,9 мм, нужно не меньше 18 мм/)
  })
  it('narrow_bridge между двумя вырезами', () => {
    const g = getTemplate('splashback')!.build({ W: 2000, H: 600, sockets: 2, s1X: 400, s1Y: 300, s2X: 400 + 75 + 10, s2Y: 300 })
    expect(of(checkDfm(g, T6), 'narrow_bridge').length).toBeGreaterThanOrEqual(1)
  })
  it('вырез за кромкой → contours_intersect', () => {
    expect(of(checkDfm(sb({ s1X: 20 }), T6), 'contours_intersect')).toHaveLength(1)
  })
  it('вогнутый острый угол внешнего контура (Г-образная деталь) → cutout_sharp_corner', () => {
    const g = parseDxf(dxf([lw([[0, 0], [1000, 0], [1000, 300], [400, 300], [400, 600], [0, 600]])]))
    expect(g.shape).toBe('curved')
    const i = of(checkDfm(g, T6), 'cutout_sharp_corner')
    expect(i).toHaveLength(1)
    expect(i[0].message).toMatch(/на контуре детали/)
  })
})

describe('итог проверки', () => {
  it('allIssues = замечания разбора + DFM; hasHardIssues', () => {
    const g = parseDxf(dxf([rectLw(0, 0, 1000, 600), circ(500, 300, 2)]))
    const all = allIssues(g, T6)
    expect(all.map(i => i.code)).toEqual(['hole_too_small'])
    expect(hasHardIssues(all)).toBe(true)
    expect(hasHardIssues(allIssues(g, A6))).toBe(false)
  })
  it('геометрия без внешнего контура (незамкнутый) — DFM молчит, решает ошибка разбора', () => {
    const g = parseDxf(dxf([lw([[0, 0], [100, 0], [100, 100]], false)]))
    expect(checkDfm(g, T6)).toEqual([])
    expect(hasHardIssues(g.issues)).toBe(true)
  })
  it('DFM работает и по геометрии из JSON без outerSegs/segs', () => {
    const g = getTemplate('splashback')!.build({ s1R: 0 })
    const json = JSON.parse(JSON.stringify({ ...g, outerSegs: undefined, cutouts: g.cutouts.map(c => ({ ...c, segs: undefined })) })) as PartGeometry
    expect(checkDfm(json, T6).map(i => i.code)).toEqual(checkDfm(g, T6).map(i => i.code))
  })
})
