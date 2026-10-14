import { describe, it, expect } from 'vitest'
import { TEMPLATES, getTemplate, defaultParams } from '@/lib/glasmen/templates'
import { parseDxf } from '@/lib/glasmen/dxf'
import { toDxf } from '@/lib/glasmen/dxfWrite'
import { checkDfm, glassRules } from '@/lib/glasmen/rules'
import { parsePathD, signedArea } from '@/lib/glasmen/geom'

const T = (id: string) => getTemplate(id)!

describe('реестр шаблонов', () => {
  it('8 шаблонов с описанием параметров для интерфейса', () => {
    expect(TEMPLATES.map(t => t.id)).toEqual(['rect', 'circle', 'ellipse', 'arch', 'shelf', 'rectWithHoles', 'splashback', 'showerPanel'])
    for (const t of TEMPLATES) {
      expect(t.title).toBeTruthy()
      expect(t.description).toBeTruthy()
      for (const p of t.params) {
        expect(p.label).toMatch(/[а-яё]/i)
        expect(p.min).toBeLessThanOrEqual(p.default)
        expect(p.default).toBeLessThanOrEqual(p.max)
        expect(p.step).toBeGreaterThan(0)
      }
    }
  })

  it('каждый шаблон по умолчанию строится без замечаний и проходит DFM (8 мм, закалка)', () => {
    for (const t of TEMPLATES) {
      const g = t.build()
      expect(g.source).toBe('template')
      expect(g.issues).toEqual([])
      expect(g.width).toBeGreaterThan(0)
      expect(g.areaNet).toBeGreaterThan(0)
      expect(checkDfm(g, glassRules(8, true)).filter(i => i.level === 'hard'), t.id).toEqual([])
    }
  })

  it('выгрузка в DXF и обратный разбор дают ту же геометрию (полилинии и отдельные LINE/ARC)', () => {
    for (const t of TEMPLATES) {
      const g = t.build()
      for (const loose of [false, true]) {
        const back = parseDxf(toDxf(g, { loose, label: g.name }))
        expect(back.issues, `${t.id} loose=${loose}`).toEqual([])
        expect(back.width).toBeCloseTo(g.width, 2)
        expect(back.height).toBeCloseTo(g.height, 2)
        expect(back.areaNet).toBeCloseTo(g.areaNet, 5)
        expect(back.perimeter).toBeCloseTo(g.perimeter, 1)
        expect(back.shape).toBe(g.shape)
        expect(back.holes.length).toBe(g.holes.length)
        expect(back.cutouts.length).toBe(g.cutouts.length)
        expect(back.cornerRadii).toEqual(g.cornerRadii)
      }
    }
  })
})

describe('геометрия шаблонов', () => {
  it('прямоугольник: острые углы → rect, скругление → curved + радиусы', () => {
    const g = T('rect').build({ W: 1200, H: 800 })
    expect(g.shape).toBe('rect')
    expect(g.areaNet).toBeCloseTo(0.96, 6)
    expect(g.perimeter).toBeCloseTo(4000, 6)
    expect(g.outerPathD).toBe('M0 0 L1200 0 L1200 800 L0 800 Z')
    const r = T('rect').build({ W: 1200, H: 800, R: 100 })
    expect(r.shape).toBe('curved')
    expect(r.cornerRadii).toEqual([100, 100, 100, 100])
    expect(r.areaNet).toBeCloseTo((1200 * 800 - (4 - Math.PI) * 1e4) / 1e6, 6)
  })

  it('радиус больше половины стороны ограничивается с предупреждением', () => {
    const g = T('rect').build({ W: 400, H: 300, R: 400 })
    expect(g.cornerRadii).toEqual([150, 150, 150, 150])
    expect(g.issues.map(i => i.code)).toEqual(['param_clamped'])
  })

  it('значение вне диапазона параметра ограничивается', () => {
    const g = T('rect').build({ W: 9000 })
    expect(g.width).toBe(6000)
    expect(g.issues[0].code).toBe('param_clamped')
    expect(g.issues[0].level).toBe('soft')
    expect(g.issues[0].message).toMatch(/«Ширина»/)
  })

  it('круг: площадь и периметр', () => {
    const g = T('circle').build({ D: 500 })
    expect(g.width).toBe(500)
    expect(g.areaNet).toBeCloseTo((Math.PI * 250 * 250) / 1e6, 6)
    expect(g.perimeter).toBeCloseTo(Math.PI * 500, 2)
    expect(g.shape).toBe('curved')
  })

  it('овал: габарит и площадь ≈ πab', () => {
    const g = T('ellipse').build({ W: 800, H: 500 })
    expect(g.width).toBeCloseTo(800, 6)
    expect(g.height).toBeCloseTo(500, 1)
    expect(g.areaNet).toBeCloseTo((Math.PI * 400 * 250) / 1e6, 4)
  })

  it('арка: площадь = прямоугольник + сегмент круга', () => {
    const W = 900, H = 2000, A = 300
    const g = T('arch').build({ W, H, A })
    const R = (W * W / 4 + A * A) / (2 * A)
    const seg = R * R * Math.acos((R - A) / R) - (R - A) * Math.sqrt(2 * R * A - A * A)
    expect(g.width).toBeCloseTo(W, 6)
    expect(g.height).toBeCloseTo(H, 6)
    expect(g.areaNet).toBeCloseTo((W * (H - A) + seg) / 1e6, 6)
    expect(g.shape).toBe('curved')
    expect(T('arch').build({ W: 800, H: 1000, A: 0 }).shape).toBe('rect')
    const semi = T('arch').build({ W: 800, H: 1000, A: 900 })
    expect(semi.issues[0].code).toBe('param_clamped')
    expect(semi.areaNet).toBeCloseTo((800 * 600 + Math.PI * 400 * 400 / 2) / 1e6, 6)
  })

  it('полка: передние углы скруглены, 2 отверстия у задней кромки', () => {
    const g = T('shelf').build({ W: 600, D: 250, R: 30, holeD: 10, holeBack: 40, holeSide: 60 })
    expect(g.cornerRadii).toEqual([0, 0, 30, 30])
    expect(g.holes).toEqual([{ cx: 60, cy: 40, d: 10 }, { cx: 540, cy: 40, d: 10 }])
    expect(T('shelf').build().holes).toEqual([])
  })

  it('прямоугольник с отверстиями: по углам и в ряд вдоль длинной стороны', () => {
    const corners = T('rectWithHoles').build({ W: 1000, H: 600, layout: 1, d: 10, offset: 40 })
    expect(corners.holes).toEqual([{ cx: 40, cy: 40, d: 10 }, { cx: 960, cy: 40, d: 10 }, { cx: 960, cy: 560, d: 10 }, { cx: 40, cy: 560, d: 10 }])
    const row = T('rectWithHoles').build({ W: 1000, H: 600, layout: 0, n: 3, d: 8, offset: 50 })
    expect(row.holes.map(h => [h.cx, h.cy])).toEqual([[50, 50], [500, 50], [950, 50]])
    const tall = T('rectWithHoles').build({ W: 400, H: 1200, layout: 0, n: 2, d: 8, offset: 50 })
    expect(tall.holes.map(h => [h.cx, h.cy])).toEqual([[50, 50], [50, 1150]])
    expect(T('rectWithHoles').build({ layout: 0, n: 1, W: 1000, H: 600, offset: 50 }).holes[0].cx).toBe(500)
  })

  it('фартук: вырезы под розетки — со скруглёнными углами, площадь за вычетом', () => {
    const g = T('splashback').build({ W: 2000, H: 600, sockets: 2, s1W: 70, s1H: 70, s1R: 10, s1X: 300, s1Y: 300 })
    expect(g.cutouts).toHaveLength(2)
    const c = g.cutouts[0]
    expect(c.bbox).toEqual({ minX: 265, minY: 265, maxX: 335, maxY: 335 })
    expect(c.minInnerRadius).toBe(10)
    const cutA = (70 * 70 - (4 - Math.PI) * 100) / 1e6
    expect(c.area).toBeCloseTo(cutA, 6)
    expect(g.areaNet).toBeCloseTo(1.2 - cutA - g.cutouts[1].area, 6)
    expect(g.shape).toBe('rect')
    expect(T('splashback').build({ sockets: 0 }).cutouts).toHaveLength(0)
  })

  it('полотно душевой: отверстия под петли вдоль выбранной кромки', () => {
    const g = T('showerPanel').build({ W: 800, H: 2000, side: 1, k: 3, d: 16, offset: 30, fromTop: 200, fromBottom: 300 })
    expect(g.holes).toEqual([{ cx: 770, cy: 200, d: 16 }, { cx: 770, cy: 950, d: 16 }, { cx: 770, cy: 1700, d: 16 }])
    expect(T('showerPanel').build({ k: 0 }).holes).toEqual([])
  })

  it('defaultParams даёт значения по умолчанию', () => {
    expect(defaultParams(T('rect'))).toEqual({ W: 1000, H: 600, R: 0 })
  })
})

describe('путь SVG', () => {
  it('parsePathD восстанавливает контур с той же площадью', () => {
    for (const t of TEMPLATES) {
      const g = t.build()
      const a = Math.abs(signedArea(parsePathD(g.outerPathD))), b = Math.abs(signedArea(g.outerSegs!))
      expect(Math.abs(a - b) / b).toBeLessThan(1e-6)
    }
  })
})
