import { describe, it, expect } from 'vitest'
import { parseDxf } from '@/lib/glasmen/dxf'
import { dxf, lw, ln, arcE, circ, text, dim, insert, rectLines, rectLw, polylineR12, splineE } from './fixtures'

const codes = (g: { issues: { code: string }[] }) => g.issues.map(i => i.code)
const B90 = Math.tan(Math.PI / 8)

describe('parseDxf — прямоугольники', () => {
  it('LWPOLYLINE в мм, смещённый от начала координат', () => {
    const g = parseDxf(dxf([rectLw(500, 300, 1000, 600)]))
    expect(g.source).toBe('dxf')
    expect(g.units).toEqual({ detected: 'mm', applied: 'mm', factorToMm: 1 })
    expect(g.width).toBe(1000)
    expect(g.height).toBe(600)
    expect(g.areaNet).toBeCloseTo(0.6, 6)
    expect(g.areaBBox).toBeCloseTo(0.6, 6)
    expect(g.perimeter).toBeCloseTo(3200, 6)
    expect(g.shape).toBe('rect')
    expect(g.holes).toEqual([])
    expect(g.cutouts).toEqual([])
    expect(g.issues).toEqual([])
    expect(g.outerPathD).toBe('M0 600 L1000 600 L1000 0 L0 0 Z')
  })

  it('из 4 разрозненных LINE в разных направлениях и с зазором 0,01 мм', () => {
    const g = parseDxf(dxf([ln(0, 0, 1000, 0), ln(0, 600, 1000.01, 600), ln(1000, 0, 1000, 600), ln(0, 0, 0, 599.99), text('Полка'), dim()]))
    expect(g.issues).toEqual([])
    expect(g.shape).toBe('rect')
    expect(g.width).toBeCloseTo(1000, 1)
    expect(g.height).toBeCloseTo(600, 1)
    expect(g.areaNet).toBeCloseTo(0.6, 4)
  })

  it('дубли линий не ломают сшивку', () => {
    const g = parseDxf(dxf([...rectLines(0, 0, 400, 300), ln(400, 0, 0, 0)]))
    expect(codes(g)).toEqual([])
    expect(g.shape).toBe('rect')
  })

  it('POLYLINE/VERTEX (R12)', () => {
    const g = parseDxf(dxf([polylineR12([[0, 0], [700, 0], [700, 400], [0, 400]])]))
    expect(g.width).toBe(700)
    expect(g.shape).toBe('rect')
    expect(g.areaNet).toBeCloseTo(0.28, 6)
  })

  it('скруглённые углы через bulge → curved и радиусы углов', () => {
    const W = 800, H = 500, R = 50
    const g = parseDxf(dxf([lw([
      [R, 0], [W - R, 0, B90], [W, R], [W, H - R, B90], [W - R, H], [R, H, B90], [0, H - R], [0, R, B90],
    ])]))
    expect(g.width).toBeCloseTo(W, 6)
    expect(g.height).toBeCloseTo(H, 6)
    expect(g.areaNet).toBeCloseTo((W * H - (4 - Math.PI) * R * R) / 1e6, 6)
    expect(g.perimeter).toBeCloseTo(2 * (W - 2 * R) + 2 * (H - 2 * R) + 2 * Math.PI * R, 2)
    expect(g.shape).toBe('curved')
    expect(g.cornerRadii).toEqual([50, 50, 50, 50])
    expect(g.outerPathD).toContain('A50 50 0 0')
  })

  it('прямоугольник со скруглениями из LINE + ARC', () => {
    const W = 600, H = 300, R = 20
    const g = parseDxf(dxf([
      ln(R, 0, W - R, 0), arcE(W - R, R, R, 270, 360), ln(W, R, W, H - R), arcE(W - R, H - R, R, 0, 90),
      ln(W - R, H, R, H), arcE(R, H - R, R, 90, 180), ln(0, H - R, 0, R), arcE(R, R, R, 180, 270),
    ]))
    expect(codes(g)).toEqual([])
    expect(g.cornerRadii).toEqual([20, 20, 20, 20])
    expect(g.width).toBeCloseTo(W, 6)
  })

  it('прямоугольник под углом 30° разворачивается к осям', () => {
    const a = (30 * Math.PI) / 180
    const P = (x: number, y: number): [number, number] => [x * Math.cos(a) - y * Math.sin(a) + 100, x * Math.sin(a) + y * Math.cos(a) + 50]
    const g = parseDxf(dxf([lw([P(0, 0), P(1000, 0), P(1000, 600), P(0, 600)])]))
    expect(g.shape).toBe('rect')
    expect(g.width).toBeCloseTo(1000, 3)
    expect(g.height).toBeCloseTo(600, 3)
    expect(g.rotatedDeg).toBeCloseTo(30, 3)
  })
})

describe('parseDxf — круги, сплайны, отверстия, вырезы', () => {
  it('круглая деталь из CIRCLE', () => {
    const g = parseDxf(dxf([circ(1000, 1000, 300)]))
    expect(g.width).toBeCloseTo(600, 6)
    expect(g.height).toBeCloseTo(600, 6)
    expect(g.areaNet).toBeCloseTo((Math.PI * 300 * 300) / 1e6, 6)
    expect(g.perimeter).toBeCloseTo(2 * Math.PI * 300, 2)
    expect(g.shape).toBe('curved')
    expect(g.holes).toEqual([])
  })

  it('2 отверстия и прямоугольный вырез; Y переворачивается', () => {
    const g = parseDxf(dxf([rectLw(0, 0, 1000, 600), circ(100, 100, 5), circ(900, 500, 5), rectLw(400, 250, 200, 100)]))
    expect(codes(g)).toEqual([])
    expect(g.holes).toHaveLength(2)
    const sorted = [...g.holes].sort((a, b) => a.cx - b.cx)
    expect(sorted[0]).toEqual({ cx: 100, cy: 500, d: 10 })
    expect(sorted[1]).toEqual({ cx: 900, cy: 100, d: 10 })
    expect(g.cutouts).toHaveLength(1)
    const c = g.cutouts[0]
    expect(c.bbox).toEqual({ minX: 400, minY: 250, maxX: 600, maxY: 350 })
    expect(c.area).toBeCloseTo(0.02, 6)
    expect(c.perimeter).toBeCloseTo(600, 6)
    expect(c.minInnerRadius).toBe(0)
    expect(g.areaNet).toBeCloseTo(0.6 - 2 * Math.PI * 25e-6 - 0.02, 6)
    expect(g.shape).toBe('rect')
  })

  it('отверстие из полилинии с двумя bulge = 1 распознаётся как отверстие', () => {
    const g = parseDxf(dxf([rectLw(0, 0, 500, 500), lw([[240, 250, 1], [260, 250, 1]])]))
    expect(g.holes).toEqual([{ cx: 250, cy: 250, d: 20 }])
    expect(g.cutouts).toHaveLength(0)
  })

  it('вырез со скруглёнными углами: minInnerRadius = радиус', () => {
    const g = parseDxf(dxf([rectLw(0, 0, 1000, 600), lw([[410, 250], [490, 250, B90], [500, 260], [500, 340, B90], [490, 350], [410, 350, B90], [400, 340], [400, 260, B90]])]))
    expect(g.cutouts[0].minInnerRadius).toBe(10)
  })

  it('NURBS-сплайн (точная окружность) → curved, площадь ≈ πr²', () => {
    const r = 200, w = Math.SQRT1_2
    const ctrl: [number, number][] = [[r, 0], [r, r], [0, r], [-r, r], [-r, 0], [-r, -r], [0, -r], [r, -r], [r, 0]]
    const g = parseDxf(dxf([splineE(2, [0, 0, 0, 0.25, 0.25, 0.5, 0.5, 0.75, 0.75, 1, 1, 1], ctrl, [1, w, 1, w, 1, w, 1, w, 1], 9)]))
    expect(codes(g)).toEqual([])
    expect(g.shape).toBe('curved')
    expect(g.width).toBeCloseTo(2 * r, 1)
    expect(g.areaNet).toBeCloseTo((Math.PI * r * r) / 1e6, 3)
  })

  it('сплайн без узлов — по точкам аппроксимации', () => {
    const fit = [[0, 0], [300, -40], [600, 0], [600, 400], [0, 400], [0, 0]]
    const e: (string | number)[] = [0, 'SPLINE', 8, 0, 70, 0, 71, 3, 74, fit.length]
    for (const [x, y] of fit) e.push(11, x, 21, y)
    const g = parseDxf(dxf([e]))
    expect(codes(g)).toEqual([])
    expect(g.width).toBeCloseTo(600, 6)
    expect(g.height).toBeCloseTo(440, 6)
  })

  it('ELLIPSE полный', () => {
    const g = parseDxf(dxf([[0, 'ELLIPSE', 8, 0, 10, 0, 20, 0, 30, 0, 11, 400, 21, 0, 31, 0, 40, 0.5, 41, 0, 42, Math.PI * 2]]))
    expect(g.width).toBeCloseTo(800, 3)
    expect(g.height).toBeCloseTo(400, 1)
    expect(g.areaNet).toBeCloseTo((Math.PI * 400 * 200) / 1e6, 3)
    expect(g.shape).toBe('curved')
  })

  it('дуга с отрицательной нормалью (OCS) зеркалится по X', () => {
    const g = parseDxf(dxf([ln(0, 0, 100, 0), arcE(-50, 0, 50, 0, 180, [210, 0, 220, 0, 230, -1])]))
    expect(codes(g)).toEqual([])
    expect(g.width).toBeCloseTo(100, 6)
    expect(g.height).toBeCloseTo(50, 6)
    expect(g.areaNet).toBeCloseTo((Math.PI * 2500) / 2 / 1e6, 6)
  })
})

describe('parseDxf — ошибки разбора', () => {
  it('незамкнутый контур → open_entities (hard)', () => {
    const g = parseDxf(dxf([ln(0, 0, 1000, 0), ln(1000, 0, 1000, 600), ln(1000, 600, 0, 600)]))
    expect(codes(g)).toEqual(['open_entities'])
    expect(g.issues[0].level).toBe('hard')
    expect(g.issues[0].at).toBeDefined()
    expect(g.issues[0].message).toMatch(/не замкнут/)
    expect(g.areaNet).toBe(0)
    expect(g.width).toBe(1000)
    expect(g.outerPathD).toMatch(/^M/)
  })

  it('разрыв в 0,2 мм больше допуска → open_entities', () => {
    const g = parseDxf(dxf([ln(0, 0, 1000, 0), ln(1000, 0, 1000, 600), ln(1000, 600, 0, 600), ln(0, 600, 0, 0.2)]))
    expect(codes(g)).toContain('open_entities')
  })

  it('пустой файл → empty_drawing', () => {
    expect(codes(parseDxf(dxf([text('только текст')])))).toEqual(['empty_drawing'])
    expect(codes(parseDxf(''))).toEqual(['empty_drawing'])
  })

  it('две отдельные детали → multiple_parts (hard), внешняя — бóльшая', () => {
    const g = parseDxf(dxf([rectLw(0, 0, 500, 500), rectLw(1000, 0, 300, 300), circ(1150, 150, 10)]))
    const iss = g.issues.find(i => i.code === 'multiple_parts')
    expect(iss?.level).toBe('hard')
    expect(iss?.message).toMatch(/2 отдельные детали/)
    expect(g.width).toBe(500)
    expect(g.holes).toEqual([])
  })

  it('контур внутри выреза → nested_contours (soft)', () => {
    const g = parseDxf(dxf([rectLw(0, 0, 1000, 1000), rectLw(200, 200, 400, 400), rectLw(300, 300, 100, 100)]))
    expect(codes(g)).toEqual(['nested_contours'])
    expect(g.issues[0].level).toBe('soft')
    expect(g.cutouts).toHaveLength(1)
  })

  it('отверстие пересекает кромку → contours_intersect (hard)', () => {
    const g = parseDxf(dxf([rectLw(0, 0, 1000, 600), circ(5, 300, 10)]))
    expect(codes(g)).toEqual(['contours_intersect'])
    expect(g.holes).toHaveLength(0)
  })
})

describe('parseDxf — единицы', () => {
  it('$INSUNITS = 1 → дюймы, переводим в мм', () => {
    const g = parseDxf(dxf([rectLw(0, 0, 10, 5)], { insunits: 1 }))
    expect(g.units).toEqual({ detected: 'inch', applied: 'inch', factorToMm: 25.4 })
    expect(g.width).toBeCloseTo(254, 6)
    expect(g.height).toBeCloseTo(127, 6)
    expect(g.areaNet).toBeCloseTo(0.254 * 0.127, 6)
    expect(codes(g)).toEqual([])
  })

  it('без $INSUNITS и деталь < 30 мм → units_suspect (soft) с подсказкой про дюймы', () => {
    const g = parseDxf(dxf([rectLw(0, 0, 10, 5)], { insunits: null }))
    expect(g.units.detected).toBe('unknown')
    expect(g.units.applied).toBe('mm')
    expect(g.width).toBe(10)
    const iss = g.issues.find(i => i.code === 'units_suspect')
    expect(iss?.level).toBe('soft')
    expect(iss?.message).toMatch(/дюйм/)
    expect(iss?.message).toMatch(/254×127/)
  })

  it('единицы, подтверждённые человеком, перекрывают файл и снимают подозрение', () => {
    const g = parseDxf(dxf([rectLw(0, 0, 10, 5)], { insunits: null }), { units: 'inch' })
    expect(g.units).toEqual({ detected: 'unknown', applied: 'inch', factorToMm: 25.4 })
    expect(g.width).toBeCloseTo(254, 6)
    expect(codes(g)).toEqual([])
  })

  it.each([
    [2, 'ft', 304.8], [5, 'cm', 10], [6, 'm', 1000],
  ] as const)('$INSUNITS = %i → %s, множитель %d', (code, unit, f) => {
    const g = parseDxf(dxf([rectLw(0, 0, 2, 1)], { insunits: code }))
    expect(g.units).toEqual({ detected: unit, applied: unit, factorToMm: f })
    expect(g.width).toBeCloseTo(2 * f, 6)
    expect(g.height).toBeCloseTo(f, 6)
  })

  it('неизвестный код единиц (3 — мили) → unknown, мм, units_unsupported', () => {
    const g = parseDxf(dxf([rectLw(0, 0, 1000, 600)], { insunits: 3 }))
    expect(g.units).toEqual({ detected: 'unknown', applied: 'mm', factorToMm: 1 })
    expect(codes(g)).toEqual(['units_unsupported'])
  })

  it('человек подтвердил сантиметры поверх объявленных метров: detected остаётся, applied — его выбор', () => {
    const g = parseDxf(dxf([rectLw(0, 0, 100, 60)], { insunits: 6 }), { units: 'cm' })
    expect(g.units).toEqual({ detected: 'm', applied: 'cm', factorToMm: 10 })
    expect(g.width).toBeCloseTo(1000, 6)
  })

  it('метры в заголовке, а чертёж явно в мм → units_suspect с пересчётом в мм', () => {
    const g = parseDxf(dxf([rectLw(0, 0, 1000, 600)], { insunits: 6 }))
    expect(g.issues[0].code).toBe('units_suspect')
    expect(g.issues[0].message).toMatch(/если чертёж в мм — 1000×600 мм/)
  })

  it('деталь > 6000 мм → units_suspect', () => {
    expect(codes(parseDxf(dxf([rectLw(0, 0, 9000, 500)])))).toEqual(['units_suspect'])
  })

  it('дюймы в заголовке, а чертёж явно в мм → units_suspect с пересчётом', () => {
    const g = parseDxf(dxf([rectLw(0, 0, 1000, 600)], { insunits: 1 }))
    expect(g.issues[0].code).toBe('units_suspect')
    expect(g.issues[0].message).toMatch(/1000×600 мм/)
  })
})

describe('parseDxf — блоки', () => {
  const blk = { name: 'PART', base: [0, 0] as [number, number], ents: [rectLw(0, 0, 100, 50), circ(50, 25, 5)] }

  it('INSERT с равномерным масштабом и поворотом разбивается', () => {
    const g = parseDxf(dxf([insert('PART', 500, 500, 2, 2, 90)], { blocks: [blk] }))
    expect(codes(g)).toEqual([])
    expect(g.width).toBeCloseTo(100, 6)
    expect(g.height).toBeCloseTo(200, 6)
    expect(g.holes).toEqual([{ cx: 50, cy: 100, d: 20 }])
  })

  it('INSERT с зеркалом по X', () => {
    const g = parseDxf(dxf([insert('PART', 0, 0, -1, 1)], { blocks: [blk] }))
    expect(g.width).toBeCloseTo(100, 6)
    expect(g.holes).toHaveLength(1)
  })

  it('неравномерный масштаб → blocks_ignored (soft)', () => {
    const g = parseDxf(dxf([rectLw(0, 0, 300, 300), insert('PART', 0, 0, 1, 2)], { blocks: [blk] }))
    expect(codes(g)).toEqual(['blocks_ignored'])
    expect(g.issues[0].level).toBe('soft')
  })
})
