// Сборщик DXF-фикстур для тестов: пары «код / значение» как в настоящих файлах.

type E = (string | number)[]

export function dxf(entities: E[], opts: { insunits?: number | null; blocks?: { name: string; base?: [number, number]; ents: E[] }[] } = {}): string {
  const out: (string | number)[] = []
  out.push(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1015')
  if (opts.insunits !== null) out.push(9, '$INSUNITS', 70, opts.insunits ?? 4)
  out.push(0, 'ENDSEC')
  if (opts.blocks?.length) {
    out.push(0, 'SECTION', 2, 'BLOCKS')
    for (const b of opts.blocks) {
      out.push(0, 'BLOCK', 8, 0, 2, b.name, 70, 0, 10, b.base?.[0] ?? 0, 20, b.base?.[1] ?? 0, 30, 0)
      for (const e of b.ents) for (const v of e) out.push(v)
      out.push(0, 'ENDBLK', 8, 0)
    }
    out.push(0, 'ENDSEC')
  }
  out.push(0, 'SECTION', 2, 'ENTITIES')
  for (const e of entities) for (const v of e) out.push(v)
  out.push(0, 'ENDSEC', 0, 'EOF')
  return out.map((v, i) => (i % 2 === 0 ? `  ${v}` : String(v))).join('\r\n') + '\r\n'
}

export const lw = (pts: [number, number, number?][], closed = true, extra: E = []): E => {
  const e: E = [0, 'LWPOLYLINE', 5, 'A1', 100, 'AcDbEntity', 8, 'CONTOUR', 100, 'AcDbPolyline', 90, pts.length, 70, closed ? 1 : 0, 43, 0, ...extra]
  for (const [x, y, b] of pts) {
    e.push(10, x, 20, y)
    if (b) e.push(42, b)
  }
  return e
}

export const ln = (x1: number, y1: number, x2: number, y2: number): E => [0, 'LINE', 8, 0, 10, x1, 20, y1, 30, 0, 11, x2, 21, y2, 31, 0]
export const arcE = (cx: number, cy: number, r: number, s: number, e: number, extra: E = []): E => [0, 'ARC', 8, 0, 10, cx, 20, cy, 30, 0, 40, r, 50, s, 51, e, ...extra]
export const circ = (cx: number, cy: number, r: number): E => [0, 'CIRCLE', 8, 'HOLES', 10, cx, 20, cy, 30, 0, 40, r]
export const text = (s: string): E => [0, 'TEXT', 8, 'NOTES', 10, 0, 20, -50, 30, 0, 40, 10, 1, s]
export const dim = (): E => [0, 'DIMENSION', 8, 'DIM', 2, '*D1', 10, 0, 20, 0, 30, 0, 70, 0, 1, '1000']
export const insert = (name: string, x: number, y: number, sx = 1, sy = 1, rot = 0): E => [0, 'INSERT', 8, 0, 2, name, 10, x, 20, y, 30, 0, 41, sx, 42, sy, 50, rot]

export const rectLines = (x: number, y: number, w: number, h: number): E[] => [
  ln(x, y, x + w, y), ln(x + w, y, x + w, y + h), ln(x + w, y + h, x, y + h), ln(x, y + h, x, y),
]

export const rectLw = (x: number, y: number, w: number, h: number): E => lw([[x, y], [x + w, y], [x + w, y + h], [x, y + h]])

export function polylineR12(pts: [number, number, number?][], closed = true): E {
  const e: E = [0, 'POLYLINE', 8, 0, 66, 1, 10, 0, 20, 0, 30, 0, 70, closed ? 1 : 0]
  for (const [x, y, b] of pts) {
    e.push(0, 'VERTEX', 8, 0, 10, x, 20, y, 30, 0)
    if (b) e.push(42, b)
  }
  e.push(0, 'SEQEND', 8, 0)
  return e
}

export function splineE(degree: number, knots: number[], ctrl: [number, number][], weights: number[] = [], flags = 8): E {
  const e: E = [0, 'SPLINE', 8, 0, 100, 'AcDbSpline', 70, flags, 71, degree, 72, knots.length, 73, ctrl.length, 74, 0]
  for (const k of knots) e.push(40, k)
  for (const w of weights) e.push(41, w)
  for (const [x, y] of ctrl) e.push(10, x, 20, y, 30, 0)
  return e
}
