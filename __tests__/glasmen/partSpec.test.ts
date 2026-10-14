import { describe, it, expect } from 'vitest'
import { buildFromSpec, defaultSpec, geometryToQuoteFacts, type PartSpec } from '@/lib/glasmen'

const spec = (p: Partial<PartSpec>): PartSpec => ({ ...defaultSpec(), ...p })

describe('деталь из шагов расчёта', () => {
  it('прямоугольник: габарит, площадь, кромка, форма rect', () => {
    const g = buildFromSpec(spec({ W: 800, H: 2000 }))
    expect([g.width, g.height]).toEqual([800, 2000])
    expect(g.areaBBox).toBeCloseTo(1.6, 6)
    expect(g.perimeter).toBeCloseTo(5600, 3)
    expect(g.shape).toBe('rect')
    expect(g.issues).toEqual([])
  })

  it('скруглённые углы, скос, круг, овал, арка — непрямоугольные (curved), габарит по форме', () => {
    for (const shape of ['rounded', 'bevel', 'ellipse', 'arch'] as const) {
      const g = buildFromSpec(spec({ shape, W: 1000, H: 600, R: 50, HL: 600, HR: 400, A: 150 }))
      expect(g.shape, shape).toBe('curved')
      expect([g.width, g.height], shape).toEqual([1000, 600])
    }
    const c = buildFromSpec(spec({ shape: 'circle', W: 600, H: 999 }))
    expect([c.width, c.height]).toEqual([600, 600])
    expect(c.shape).toBe('curved')
  })

  it('скос с равными высотами = прямоугольник; площадь трапеции', () => {
    expect(buildFromSpec(spec({ shape: 'bevel', W: 1000, H: 600, HL: 600, HR: 600 })).shape).toBe('rect')
    const g = buildFromSpec(spec({ shape: 'bevel', W: 1000, H: 600, HL: 600, HR: 400 }))
    expect(g.areaNet).toBeCloseTo((1000 * (600 + 400)) / 2 / 1e6, 6)
  })

  it('отверстия: по углам — 4 шт., ряды — равномерно от торца до торца', () => {
    const corners = buildFromSpec(spec({ W: 1000, H: 600, holes: [{ d: 10, n: 99, layout: 'corners', edge: 45, end: 0 }] }))
    expect(corners.holes.map(h => [h.cx, h.cy])).toEqual([[45, 45], [955, 45], [955, 555], [45, 555]])
    const side = buildFromSpec(spec({ W: 800, H: 2000, holes: [{ d: 16, n: 2, layout: 'rowSide', edge: 30, end: 250 }] }))
    expect(side.holes.map(h => [h.cx, h.cy])).toEqual([[30, 250], [30, 1750]])
    const top = buildFromSpec(spec({ W: 1000, H: 600, holes: [{ d: 8, n: 3, layout: 'rowTop', edge: 40, end: 100 }] }))
    expect(top.holes.map(h => h.cx)).toEqual([100, 500, 900])
    expect(geometryToQuoteFacts(side).holes).toEqual([{ d: 16, n: 2 }])
  })

  it('вырезы: n штук в ряд по ширине, считаются в цену как вырезы', () => {
    const g = buildFromSpec(spec({ W: 2000, H: 600, cutouts: [{ w: 75, h: 75, r: 8, n: 2, fromTop: 300 }] }))
    expect(g.cutouts).toHaveLength(2)
    expect(g.cutouts.map(c => Math.round((c.bbox.minX + c.bbox.maxX) / 2))).toEqual([500, 1500])
    expect(geometryToQuoteFacts(g).cutouts).toBe(2)
  })

  it('значения вне пределов зажимаются и называются замечанием, а не падают', () => {
    const g = buildFromSpec(spec({ W: 9000, H: Number.NaN, holes: [{ d: 500, n: 2, layout: 'rowTop', edge: 40, end: 100 }] }))
    expect(g.width).toBe(6000)
    expect(g.height).toBe(30)
    expect(g.holes[0].d).toBe(100)
    expect(g.issues.filter(i => i.code === 'param_clamped').length).toBeGreaterThanOrEqual(3)
  })
})
