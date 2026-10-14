import { describe, it, expect } from 'vitest'
import { parseDxf, DXF_LIMITS } from '@/lib/glasmen/dxf'
import { geometryToQuoteFacts } from '@/lib/glasmen/toQuoteInput'
import { allIssues, glassRules } from '@/lib/glasmen/rules'
import { dxf, ln, circ, insert, rectLw, splineE } from './fixtures'

// Файл приходит от посетителя: любой из этих чертежей раньше вешал вкладку или молча
// превращал «1e400» в ноль. Каждый обязан вернуться быстро и с жёстким замечанием.

const codes = (g: { issues: { code: string }[] }) => g.issues.map(i => i.code)

function timed<T>(fn: () => T): { v: T; ms: number } {
  const t = performance.now()
  const v = fn()
  return { v, ms: performance.now() - t }
}

const ellipseE = (t0: number | string, t1: number | string) =>
  [0, 'ELLIPSE', 8, 0, 10, 500, 20, 300, 30, 0, 11, 400, 21, 0, 31, 0, 40, 0.5, 41, t0, 42, t1]

describe('parseDxf — пределы разбора', () => {
  it('ELLIPSE с огромными параметрами не зацикливается: углы приводятся по модулю 2π', () => {
    const { v: g, ms } = timed(() => parseDxf(dxf([ellipseE(9e8, -9e8)])))
    expect(ms).toBeLessThan(1000)
    expect(g.width).toBeGreaterThan(0)
    expect(codes(g).filter(c => c === 'too_complex' || c === 'bad_numbers')).toEqual([])
  })

  it('полный эллипс (0…2π) остаётся замкнутым и с прежним разбиением', () => {
    const g = parseDxf(dxf([ellipseE(0, 2 * Math.PI)]))
    expect(g.issues).toEqual([])
    expect(g.width).toBeCloseTo(800, 3)
    expect(g.height).toBeCloseTo(400, 3)
  })

  it('«1e400» в координате → bad_numbers (hard), без геометрии', () => {
    const { v: g, ms } = timed(() => parseDxf(dxf([rectLw(0, 0, 1000, 600), ln(0, 0, '1e400' as unknown as number, 5)])))
    expect(ms).toBeLessThan(1000)
    expect(codes(g)).toEqual(['bad_numbers'])
    expect(g.issues[0].level).toBe('hard')
    expect(g.issues[0].message).toMatch(/нечисловые или бесконечные координаты/)
    expect(g.outerPathD).toBe('')
  })

  it('бесконечный параметр эллипса и текст вместо числа → bad_numbers', () => {
    expect(codes(parseDxf(dxf([ellipseE(0, '1e400')])))).toEqual(['bad_numbers'])
    expect(codes(parseDxf(dxf([rectLw(0, 0, 100, 100), [0, 'CIRCLE', 8, 0, 10, 'abc', 20, 5, 40, 3]])))).toEqual(['bad_numbers'])
  })

  it('число больше миллиарда → bad_numbers (иначе площадь переполняется)', () => {
    expect(codes(parseDxf(dxf([rectLw(0, 0, 2e9, 600)])))).toEqual(['bad_numbers'])
  })

  it('«бомба» из вложенных INSERT (50⁴ раскрытий) → too_complex за секунду', () => {
    const blocks = [
      { name: 'L0', ents: [rectLw(0, 0, 10, 10)] },
      ...[1, 2, 3].map(i => ({ name: `L${i}`, ents: Array.from({ length: 50 }, (_, k) => insert(`L${i - 1}`, k * 20, 0)) })),
    ]
    const top = Array.from({ length: 50 }, (_, k) => insert('L3', 0, k * 20))
    const text = dxf(top, { blocks })
    const { v: g, ms } = timed(() => parseDxf(text))
    expect(ms).toBeLessThan(1000)
    expect(codes(g)).toEqual(['too_complex'])
    expect(g.issues[0].level).toBe('hard')
  })

  it('сплайн степени выше предела пропускается с замечанием, а не считается', () => {
    const deg = DXF_LIMITS.splineDegree + 40
    const ctrl: [number, number][] = Array.from({ length: deg + 1 }, (_, i) => [i * 10, (i % 2) * 10])
    const knots = [...Array(deg + 1).fill(0), ...Array(deg + 1).fill(1)]
    const { v: g, ms } = timed(() => parseDxf(dxf([rectLw(0, 0, 1000, 600), splineE(deg, knots, ctrl)])))
    expect(ms).toBeLessThan(1000)
    expect(codes(g)).toEqual(['unsupported_entities'])
    expect(g.issues[0].message).toMatch(/Сплайн степени выше 10/)
  })

  it('сплайн с 20 000 управляющих точек разбирается быстро (не больше предела выборок)', () => {
    const n = 20_000
    const ctrl: [number, number][] = Array.from({ length: n }, (_, i) => [i * 0.05, Math.sin(i / 100) * 50])
    const knots = [0, 0, 0, ...Array.from({ length: n - 2 }, (_, i) => i), n - 3, n - 3, n - 3]
    const text = dxf([splineE(3, knots, ctrl)])
    const { v: g, ms } = timed(() => parseDxf(text))
    expect(ms).toBeLessThan(1000)
    expect(codes(g)).toContain('open_entities')
  })

  it('«звезда» из тысяч отрезков с общей точкой → too_complex (сшивка не квадратичная бесконечно)', () => {
    const ents = Array.from({ length: 5000 }, (_, i) => ln(0, 0, Math.cos(i) * 100, Math.sin(i) * 100))
    const text = dxf(ents)
    const { v: g, ms } = timed(() => parseDxf(text))
    expect(ms).toBeLessThan(1000)
    expect(codes(g)).toEqual(['too_complex'])
  })

  it(`больше ${DXF_LIMITS.contours} замкнутых контуров → too_complex`, () => {
    const holes = Array.from({ length: DXF_LIMITS.contours + 50 }, (_, i) => circ(20 + (i % 40) * 40, 20 + Math.floor(i / 40) * 40, 5))
    const text = dxf([rectLw(0, 0, 2000, 1500), ...holes])
    const { v: g, ms } = timed(() => parseDxf(text))
    expect(ms).toBeLessThan(1000)
    expect(codes(g)).toEqual(['too_complex'])
  })
})

describe('parseDxf — круглые вырезы', () => {
  it('круг Ø100 — отверстие, Ø150 — круглый вырез с геометрией', () => {
    const g = parseDxf(dxf([rectLw(0, 0, 1000, 600), circ(200, 300, 50), circ(600, 300, 75)]))
    expect(g.issues).toEqual([])
    expect(g.holes).toEqual([{ cx: 200, cy: 300, d: 100 }])
    expect(g.cutouts).toHaveLength(1)
    expect(g.cutouts[0].bbox).toEqual({ minX: 525, minY: 225, maxX: 675, maxY: 375 })
    expect(g.cutouts[0].area).toBeCloseTo(Math.PI * 0.075 ** 2, 6)
    expect(geometryToQuoteFacts(g)).toMatchObject({ holes: [{ d: 100, n: 1 }], cutouts: 1, hasCutouts: true })
  })

  it('круглый вырез проверяется как вырез: перемычка до кромки', () => {
    const g = parseDxf(dxf([rectLw(0, 0, 1000, 600), circ(85, 300, 75)]))
    const iss = allIssues(g, glassRules(8, true))
    expect(iss.map(i => i.code)).toEqual(['narrow_bridge'])
    expect(iss[0].message).toMatch(/вырезом и кромкой 10 мм/)
  })
})
