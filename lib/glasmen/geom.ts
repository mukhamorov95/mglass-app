import type { BBox, CutoutGeom, DfmIssue, HoleGeom, PartGeometry, Pt, Seg } from './types'

export const TAU = Math.PI * 2
const DEG = Math.PI / 180

export const pt = (x: number, y: number): Pt => ({ x, y })
export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)
const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x
const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y

export const arcPoint = (c: Pt, r: number, ang: number): Pt => ({ x: c.x + r * Math.cos(ang), y: c.y + r * Math.sin(ang) })

export function segStart(s: Seg): Pt {
  return s.kind === 'line' ? s.a : arcPoint(s.c, s.r, s.a0)
}
export function segEnd(s: Seg): Pt {
  return s.kind === 'line' ? s.b : arcPoint(s.c, s.r, s.a0 + s.sweep)
}
export function reverseSeg(s: Seg): Seg {
  return s.kind === 'line'
    ? { kind: 'line', a: s.b, b: s.a }
    : { kind: 'arc', c: s.c, r: s.r, a0: s.a0 + s.sweep, sweep: -s.sweep }
}
export function segLength(s: Seg): number {
  return s.kind === 'line' ? dist(s.a, s.b) : s.r * Math.abs(s.sweep)
}

export const line = (a: Pt, b: Pt): Seg => ({ kind: 'line', a, b })
export const arc = (c: Pt, r: number, a0: number, sweep: number): Seg => ({ kind: 'arc', c, r, a0, sweep })
export const circleSegs = (c: Pt, r: number): Seg[] => [arc(c, r, 0, TAU)]

// Дуга по «выпуклости» DXF: bulge = tan(θ/4), > 0 — против часовой.
export function bulgeSeg(p1: Pt, p2: Pt, bulge: number): Seg {
  const d = dist(p1, p2)
  if (Math.abs(bulge) < 1e-12 || d < 1e-12) return line(p1, p2)
  const theta = 4 * Math.atan(bulge)
  const u = { x: (p2.x - p1.x) / d, y: (p2.y - p1.y) / d }
  const h = (d / 2) / Math.tan(theta / 2)
  const c = { x: (p1.x + p2.x) / 2 - u.y * h, y: (p1.y + p2.y) / 2 + u.x * h }
  const r = d / (2 * Math.abs(Math.sin(theta / 2)))
  return arc(c, r, Math.atan2(p1.y - c.y, p1.x - c.x), theta)
}

function norm(a: number): number {
  const m = a % TAU
  return m < 0 ? m + TAU : m
}

export function angleInSweep(a0: number, sweep: number, th: number): boolean {
  if (Math.abs(sweep) >= TAU - 1e-12) return true
  return sweep >= 0 ? norm(th - a0) <= sweep + 1e-12 : norm(a0 - th) <= -sweep + 1e-12
}

// ---------- Аффинное подобие: зеркало по Y → поворот → масштаб → сдвиг ----------

export type Sim = { s?: number; rot?: number; flipY?: boolean; tx?: number; ty?: number }

export function simPt(m: Sim, p: Pt): Pt {
  const s = m.s ?? 1, rot = m.rot ?? 0
  const x = p.x, y = m.flipY ? -p.y : p.y
  const cr = Math.cos(rot), sr = Math.sin(rot)
  return { x: (m.tx ?? 0) + s * (x * cr - y * sr), y: (m.ty ?? 0) + s * (x * sr + y * cr) }
}

export function simSeg(m: Sim, sg: Seg): Seg {
  if (sg.kind === 'line') return line(simPt(m, sg.a), simPt(m, sg.b))
  const a0 = (m.flipY ? -sg.a0 : sg.a0) + (m.rot ?? 0)
  return arc(simPt(m, sg.c), sg.r * Math.abs(m.s ?? 1), a0, m.flipY ? -sg.sweep : sg.sweep)
}

export const simSegs = (m: Sim, segs: Seg[]) => segs.map(s => simSeg(m, s))

// ---------- Метрики ----------

function arcSteps(r: number, sweep: number, maxErr: number): number {
  const raw = r > maxErr ? 2 * Math.acos(1 - maxErr / r) : 5 * DEG
  const step = Math.min(5 * DEG, Math.max(0.25 * DEG, raw))
  return Math.max(2, Math.ceil(Math.abs(sweep) / step))
}

export function tessellate(segs: Seg[], closed = true, maxErr = 0.02): Pt[] {
  const out: Pt[] = []
  for (const s of segs) {
    out.push(segStart(s))
    if (s.kind === 'arc') {
      const n = arcSteps(s.r, s.sweep, maxErr)
      for (let i = 1; i < n; i++) out.push(arcPoint(s.c, s.r, s.a0 + (s.sweep * i) / n))
    }
  }
  if (!closed && segs.length) out.push(segEnd(segs[segs.length - 1]))
  return out
}

// Точная площадь по Грину: отрезки и дуги аналитически; стыки цепочки
// (разрывы в пределах допуска) замыкаются прямыми, чтобы сдвиг координат не давал ошибки.
export function signedArea(segs: Seg[]): number {
  let a = 0
  const lineTerm = (p: Pt, q: Pt) => 0.5 * (p.x * q.y - q.x * p.y)
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]
    if (s.kind === 'line') a += lineTerm(s.a, s.b)
    else {
      const t1 = s.a0, t2 = s.a0 + s.sweep
      a += 0.5 * (s.r * s.r * s.sweep + s.r * (s.c.x * (Math.sin(t2) - Math.sin(t1)) - s.c.y * (Math.cos(t2) - Math.cos(t1))))
    }
    const nx = segs[(i + 1) % segs.length]
    a += lineTerm(segEnd(s), segStart(nx))
  }
  return a
}

export const perimeterOf = (segs: Seg[]) => segs.reduce((acc, s) => acc + segLength(s), 0)

export function bboxOf(segs: Seg[]): BBox {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  const add = (p: Pt) => {
    if (p.x < b.minX) b.minX = p.x
    if (p.y < b.minY) b.minY = p.y
    if (p.x > b.maxX) b.maxX = p.x
    if (p.y > b.maxY) b.maxY = p.y
  }
  for (const s of segs) {
    add(segStart(s)); add(segEnd(s))
    if (s.kind === 'arc') {
      for (let k = 0; k < 4; k++) {
        const th = (k * Math.PI) / 2
        if (angleInSweep(s.a0, s.sweep, th)) add(arcPoint(s.c, s.r, th))
      }
    }
  }
  return b
}

export function bboxOfPts(pts: Pt[]): BBox {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  for (const p of pts) {
    b.minX = Math.min(b.minX, p.x); b.minY = Math.min(b.minY, p.y)
    b.maxX = Math.max(b.maxX, p.x); b.maxY = Math.max(b.maxY, p.y)
  }
  return b
}

export function pointInPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

export function distPtSeg(p: Pt, s: Seg): number {
  if (s.kind === 'line') {
    const v = { x: s.b.x - s.a.x, y: s.b.y - s.a.y }
    const L2 = dot(v, v)
    const t = L2 < 1e-18 ? 0 : Math.max(0, Math.min(1, ((p.x - s.a.x) * v.x + (p.y - s.a.y) * v.y) / L2))
    return dist(p, { x: s.a.x + t * v.x, y: s.a.y + t * v.y })
  }
  const th = Math.atan2(p.y - s.c.y, p.x - s.c.x)
  if (angleInSweep(s.a0, s.sweep, th)) return Math.abs(dist(p, s.c) - s.r)
  return Math.min(dist(p, segStart(s)), dist(p, segEnd(s)))
}

export function distPtSegs(p: Pt, segs: Seg[]): { d: number; seg: number } {
  let best = { d: Infinity, seg: -1 }
  segs.forEach((s, i) => {
    const d = distPtSeg(p, s)
    if (d < best.d) best = { d, seg: i }
  })
  return best
}

// Минимальный зазор между двумя контурами: по точкам разбиения одного до отрезков другого.
export function gapBetween(a: Seg[], b: Seg[]): { d: number; at: Pt } {
  let best = { d: Infinity, at: pt(0, 0) }
  const scan = (from: Seg[], to: Seg[]) => {
    for (const p of tessellate(from, true, 0.05)) {
      const d = distPtSegs(p, to).d
      if (d < best.d) best = { d, at: p }
    }
  }
  scan(a, b); scan(b, a)
  return best
}

// ---------- SVG path ----------

export function fmtNum(n: number): string {
  const r = Math.round(n * 1000) / 1000
  return Object.is(r, -0) || r === 0 ? '0' : String(r)
}

export function pathD(segs: Seg[], closed = true): string {
  if (!segs.length) return ''
  const p0 = segStart(segs[0])
  const parts = [`M${fmtNum(p0.x)} ${fmtNum(p0.y)}`]
  const arcCmd = (s: Extract<Seg, { kind: 'arc' }>, sweep: number, a0: number) => {
    const e = arcPoint(s.c, s.r, a0 + sweep)
    return `A${fmtNum(s.r)} ${fmtNum(s.r)} 0 ${Math.abs(sweep) > Math.PI ? 1 : 0} ${sweep > 0 ? 1 : 0} ${fmtNum(e.x)} ${fmtNum(e.y)}`
  }
  segs.forEach((s, i) => {
    if (s.kind === 'line') {
      if (!(closed && i === segs.length - 1 && i > 0 && dist(s.b, p0) < 1e-9)) parts.push(`L${fmtNum(s.b.x)} ${fmtNum(s.b.y)}`)
    }
    else if (Math.abs(s.sweep) > Math.PI) {
      parts.push(arcCmd(s, s.sweep / 2, s.a0), arcCmd(s, s.sweep / 2, s.a0 + s.sweep / 2))
    } else parts.push(arcCmd(s, s.sweep, s.a0))
  })
  if (closed) parts.push('Z')
  return parts.join(' ')
}

// Обратный разбор нашего же формата (M/L/A/Z, без поворота эллипса) — чтобы
// проверка DFM работала и по геометрии, пришедшей из JSON без outerSegs.
export function parsePathD(d: string): Seg[] {
  const tok = d.match(/[MLAZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []
  const segs: Seg[] = []
  let i = 0
  let cur = pt(0, 0), start = pt(0, 0)
  const num = () => Number(tok[i++])
  while (i < tok.length) {
    const cmd = tok[i++].toUpperCase()
    if (cmd === 'M') { cur = pt(num(), num()); start = cur }
    else if (cmd === 'L') { const p = pt(num(), num()); segs.push(line(cur, p)); cur = p }
    else if (cmd === 'A') {
      const r0 = num(); num(); num()
      const large = num() === 1, sweepPos = num() === 1
      const p = pt(num(), num())
      const dd = dist(cur, p)
      const r = Math.max(r0, dd / 2)
      const h = Math.sqrt(Math.max(0, r * r - (dd / 2) ** 2))
      const u = { x: (p.x - cur.x) / dd, y: (p.y - cur.y) / dd }
      const side = sweepPos === !large ? 1 : -1
      const c = { x: (cur.x + p.x) / 2 - u.y * h * side, y: (cur.y + p.y) / 2 + u.x * h * side }
      const a0 = Math.atan2(cur.y - c.y, cur.x - c.x)
      const a1 = Math.atan2(p.y - c.y, p.x - c.x)
      const sw = sweepPos ? norm(a1 - a0) : -norm(a0 - a1)
      segs.push(arc(c, r, a0, sw))
      cur = p
    } else if (cmd === 'Z') {
      if (dist(cur, start) > 1e-6) segs.push(line(cur, start))
      cur = start
    }
  }
  return segs
}

// ---------- Углы контура ----------

export function tangentStart(s: Seg): Pt {
  if (s.kind === 'line') { const L = dist(s.a, s.b) || 1; return { x: (s.b.x - s.a.x) / L, y: (s.b.y - s.a.y) / L } }
  const k = s.sweep >= 0 ? 1 : -1
  return { x: -Math.sin(s.a0) * k, y: Math.cos(s.a0) * k }
}
export function tangentEnd(s: Seg): Pt {
  if (s.kind === 'line') return tangentStart(s)
  const k = s.sweep >= 0 ? 1 : -1, t = s.a0 + s.sweep
  return { x: -Math.sin(t) * k, y: Math.cos(t) * k }
}

export type Joint = { at: Pt; turn: number; i: number }

export function joints(segs: Seg[]): Joint[] {
  return segs.map((s, i) => {
    const nx = segs[(i + 1) % segs.length]
    const t1 = tangentEnd(s), t2 = tangentStart(nx)
    return { at: segEnd(s), turn: Math.atan2(cross(t1, t2), dot(t1, t2)), i }
  })
}

export const CORNER_TURN = 10 * DEG

// Внутренние углы стекла: у выреза — выпуклые углы самого выреза, у внешнего
// контура — вогнутые (вырез с кромки, «Г»-образная деталь).
export function glassInnerCorners(segs: Seg[], isCutout: boolean): { minRadius: number | null; sharp: Pt[]; arcs: { r: number; at: Pt }[] } {
  const sign = Math.sign(signedArea(segs)) || 1
  const want = isCutout ? sign : -sign
  const sharp: Pt[] = []
  const arcs: { r: number; at: Pt }[] = []
  for (const j of joints(segs)) {
    if (Math.abs(j.turn) > CORNER_TURN && Math.sign(j.turn) === want) sharp.push(j.at)
  }
  for (const s of segs) {
    if (s.kind === 'arc' && Math.sign(s.sweep) === want && Math.abs(s.sweep) < TAU - 1e-6) {
      arcs.push({ r: s.r, at: arcPoint(s.c, s.r, s.a0 + s.sweep / 2) })
    }
  }
  const radii = [...sharp.map(() => 0), ...arcs.map(a => a.r)]
  return { minRadius: radii.length ? Math.min(...radii) : null, sharp, arcs }
}

// Углы детали для правила «отверстие у угла»: острые выпуклые вершины и
// середины небольших выпуклых скруглений (скруглённый угол прямоугольника).
export function outerCorners(segs: Seg[]): Pt[] {
  const sign = Math.sign(signedArea(segs)) || 1
  const out: Pt[] = []
  for (const j of joints(segs)) if (Math.abs(j.turn) > 30 * DEG && Math.sign(j.turn) === sign) out.push(j.at)
  for (const s of segs) {
    if (s.kind === 'arc' && Math.sign(s.sweep) === sign && s.r <= 100 && Math.abs(s.sweep) >= 45 * DEG && Math.abs(s.sweep) < TAU - 1e-6) {
      out.push(arcPoint(s.c, s.r, s.a0 + s.sweep / 2))
    }
  }
  return out
}

// ---------- Форма внешнего контура ----------

export type ShapeInfo = { shape: 'rect' | 'curved'; cornerRadii?: number[]; rectAngle?: number }

const RECT_TOL = 0.5

export function analyzeShape(segs: Seg[]): ShapeInfo {
  const js = joints(segs)
  const sign = Math.sign(signedArea(segs)) || 1
  if (segs.every(s => s.kind === 'line')) {
    const corners = js.filter(j => Math.abs(j.turn) > 1 * DEG)
    if (corners.length !== 4) return { shape: 'curved' }
    if (!corners.every(j => Math.abs(Math.abs(j.turn) - Math.PI / 2) < 1 * DEG && Math.sign(j.turn) === sign)) return { shape: 'curved' }
    const P = corners.map(j => j.at)
    const L = (a: number, b: number) => dist(P[a], P[b])
    if (Math.abs(L(0, 1) - L(2, 3)) > RECT_TOL || Math.abs(L(1, 2) - L(3, 0)) > RECT_TOL || Math.abs(L(0, 2) - L(1, 3)) > RECT_TOL) return { shape: 'curved' }
    const sides = [line(P[0], P[1]), line(P[1], P[2]), line(P[2], P[3]), line(P[3], P[0])]
    for (const s of segs) {
      const p = segStart(s)
      if (Math.min(...sides.map(sd => distPtSeg(p, sd))) > RECT_TOL) return { shape: 'curved' }
    }
    return { shape: 'rect', rectAngle: Math.atan2(P[1].y - P[0].y, P[1].x - P[0].x) }
  }
  // Прямоугольник со скруглёнными углами: прямые по осям, 4 угла — острые 90° или дуги 90°.
  // Вопрос владельцу (ревью демо GLASMEN 14.10): такой прямоугольник уходит в цену как 'curved' и
  // получает надбавку за криволинейную форму. Поведение не меняем до его решения.
  const feats: { at: Pt; r: number }[] = []
  for (const s of segs) {
    if (s.kind === 'line') {
      if (Math.abs(s.a.x - s.b.x) > RECT_TOL && Math.abs(s.a.y - s.b.y) > RECT_TOL) return { shape: 'curved' }
    } else {
      if (Math.sign(s.sweep) !== sign || Math.abs(Math.abs(s.sweep) - Math.PI / 2) > 1 * DEG) return { shape: 'curved' }
      feats.push({ at: arcPoint(s.c, s.r, s.a0 + s.sweep / 2), r: s.r })
    }
  }
  for (const j of js) {
    const a = Math.abs(j.turn)
    if (a <= 1 * DEG) continue
    if (Math.abs(a - Math.PI / 2) > 1 * DEG || Math.sign(j.turn) !== sign) return { shape: 'curved' }
    feats.push({ at: j.at, r: 0 })
  }
  if (feats.length !== 4) return { shape: 'curved' }
  const bb = bboxOf(segs)
  const cx = (bb.minX + bb.maxX) / 2, cy = (bb.minY + bb.maxY) / 2
  const pick = (left: boolean, top: boolean) => feats.find(f => (f.at.x < cx) === left && (f.at.y < cy) === top)
  const order = [pick(true, true), pick(false, true), pick(false, false), pick(true, false)]
  if (order.some(f => !f)) return { shape: 'curved' }
  return { shape: 'curved', cornerRadii: order.map(f => round(f!.r, 3)) }
}

// ---------- Окружность ----------

export function circleOf(segs: Seg[]): { c: Pt; r: number } | null {
  if (segs.every(s => s.kind === 'arc')) {
    const a = segs as Extract<Seg, { kind: 'arc' }>[]
    const c = a[0].c, r = a[0].r
    const tol = Math.max(0.01, r * 1e-4)
    if (!a.every(s => dist(s.c, c) <= tol && Math.abs(s.r - r) <= tol)) return null
    const total = a.reduce((acc, s) => acc + Math.abs(s.sweep), 0)
    return Math.abs(total - TAU) < 1e-3 ? { c, r } : null
  }
  if (segs.length >= 16 && segs.every(s => s.kind === 'line')) {
    const ps = segs.map(segStart)
    const c = { x: ps.reduce((a, p) => a + p.x, 0) / ps.length, y: ps.reduce((a, p) => a + p.y, 0) / ps.length }
    const rs = ps.map(p => dist(p, c))
    const r = rs.reduce((a, b) => a + b, 0) / rs.length
    const tol = Math.max(0.05, r * 0.005)
    return rs.every(x => Math.abs(x - r) <= tol) ? { c, r } : null
  }
  return null
}

// ---------- Сборка PartGeometry ----------

export const round = (n: number, digits = 2) => {
  const k = 10 ** digits
  const r = Math.round(n * k) / k
  return Object.is(r, -0) ? 0 : r
}

export function cutoutGeom(segs: Seg[]): CutoutGeom {
  const bb = bboxOf(segs)
  return {
    pathD: pathD(segs),
    bbox: { minX: round(bb.minX, 3), minY: round(bb.minY, 3), maxX: round(bb.maxX, 3), maxY: round(bb.maxY, 3) },
    area: round(Math.abs(signedArea(segs)) / 1e6, 6),
    perimeter: round(perimeterOf(segs)),
    minInnerRadius: (() => { const m = glassInnerCorners(segs, true).minRadius; return m === null ? null : round(m, 3) })(),
    segs,
  }
}

export type BuildInput = {
  source: PartGeometry['source']
  name: string
  units: PartGeometry['units']
  outer: Seg[] | null
  holes: HoleGeom[]
  cutouts: Seg[][]
  issues: DfmIssue[]
  openPathD?: string
  forceCurved?: boolean
  rotatedDeg?: number
  bboxOverride?: BBox
}

export function buildPart(inp: BuildInput): PartGeometry {
  const holes = inp.holes.map(h => ({ cx: round(h.cx, 3), cy: round(h.cy, 3), d: round(h.d, 3) }))
  const cutouts = inp.cutouts.map(cutoutGeom)
  if (!inp.outer || !inp.outer.length) {
    const bb = inp.bboxOverride
    const w = bb ? bb.maxX - bb.minX : 0, h = bb ? bb.maxY - bb.minY : 0
    return {
      source: inp.source, name: inp.name, units: inp.units,
      width: round(w), height: round(h), areaNet: 0, areaBBox: round((w * h) / 1e6, 6), perimeter: 0,
      outerPathD: inp.openPathD ?? '', holes, cutouts, shape: 'curved', issues: inp.issues,
    }
  }
  const bb = bboxOf(inp.outer)
  const w = bb.maxX - bb.minX, h = bb.maxY - bb.minY
  const outerArea = Math.abs(signedArea(inp.outer))
  const holesArea = inp.holes.reduce((a, x) => a + (Math.PI * x.d * x.d) / 4, 0)
  const cutArea = inp.cutouts.reduce((a, c) => a + Math.abs(signedArea(c)), 0)
  const info = analyzeShape(inp.outer)
  const geom: PartGeometry = {
    source: inp.source, name: inp.name, units: inp.units,
    width: round(w), height: round(h),
    areaNet: round((outerArea - holesArea - cutArea) / 1e6, 6),
    areaBBox: round((w * h) / 1e6, 6),
    perimeter: round(perimeterOf(inp.outer)),
    outerPathD: pathD(inp.outer),
    holes, cutouts,
    shape: inp.forceCurved ? 'curved' : info.shape,
    issues: inp.issues,
    outerSegs: inp.outer,
  }
  if (info.cornerRadii) geom.cornerRadii = info.cornerRadii
  if (inp.rotatedDeg) geom.rotatedDeg = round(inp.rotatedDeg, 3)
  return geom
}

export function numRu(n: number, digits = 1): string {
  return String(round(n, digits)).replace('.', ',')
}
