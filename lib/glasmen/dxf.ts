import { MAX_HOLE_D_MM, type BBox, type DfmIssue, type DxfUnit, type HoleGeom, type PartGeometry, type Pt, type Seg } from './types'
import {
  TAU, arc, bboxOf, bboxOfPts, buildPart, bulgeSeg, circleOf, analyzeShape, dist, line, numRu,
  pathD, pointInPoly, reverseSeg, round, segEnd, segLength, segStart, signedArea, simSegs, tessellate,
  type Sim,
} from './geom'

// Минимальный читатель ASCII DXF: только то, что нужно для плоской стеклянной детали.
// Без зависимостей — формат простой (пары «код / значение»), а dxf-парсеры из npm
// либо не держат bulge/OCS, либо тянут лишнее.

export const CHAIN_TOL_MM = 0.05
const INCH = 25.4
const DEG = Math.PI / 180
const MAX_BLOCK_DEPTH = 4

// Множитель «единица чертежа → мм» и коды $INSUNITS, которые читаем (1 дюйм, 2 фут, 4 мм, 5 см, 6 м).
export const DXF_UNIT_TO_MM: Record<DxfUnit, number> = { mm: 1, cm: 10, m: 1000, inch: INCH, ft: 304.8 }
const INSUNITS: Partial<Record<number, DxfUnit>> = { 1: 'inch', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm' }

// Пределы разбора: файл приходит от посетителя, и вложенные блоки, огромные параметры или
// число элементов не должны вешать вкладку. Превышение — жёсткое замечание too_complex.
export const DXF_LIMITS = {
  elements: 200_000,         // объектов (с раскрытием блоков) + отрезков разбиения
  chainWork: 5_000_000,      // проверок концов при сшивке контуров
  geomWork: 50_000_000,      // операций «точка × ребро» в проверках вложенности и DFM
  contours: 1_000,           // замкнутых контуров
  cutouts: 100,              // вырезов (кругов крупнее отверстия и фигурных)
  coord: 1e9,                // |число| в чертеже; больше — переполнение, а не деталь
  splineDegree: 10,
  splineSamples: 2_000,
  ellipseSamples: 720,
} as const

class TooComplex extends Error {}
type Meter = { left: number }
const spend = (m: Meter, n: number) => {
  m.left -= n
  if (m.left < 0) throw new TooComplex()
}

type Pair = { code: number; value: string }
type Ent = { type: string; pairs: Pair[] }
type Piece = { segs: Seg[]; closed: boolean }
type Ctx = { blocks: Map<string, { base: Pt; ents: Ent[] }>; skippedBlocks: Set<string>; unsupported: Set<string>; badSplines: number; elements: Meter }

export type ParseDxfOptions = { units?: DxfUnit; name?: string }

// Числовые группы DXF (координаты, размеры, углы, флаги) — по спецификации кодов групп.
const isNumericCode = (c: number) => (c >= 10 && c <= 99) || (c >= 210 && c <= 239)

function badNumber(pairs: Pair[]): boolean {
  for (const p of pairs) {
    if (!isNumericCode(p.code)) continue
    const v = Number(p.value)
    if (!Number.isFinite(v) || Math.abs(v) > DXF_LIMITS.coord) return true
  }
  return false
}

function readPairs(text: string): Pair[] {
  const lines = text.split(/\r\n|\r|\n/)
  const out: Pair[] = []
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number.parseInt(lines[i].trim(), 10)
    if (Number.isNaN(code)) continue
    out.push({ code, value: lines[i + 1].trim() })
  }
  return out
}

function sections(pairs: Pair[]): Map<string, Pair[]> {
  const out = new Map<string, Pair[]>()
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i].code === 0 && pairs[i].value === 'SECTION' && pairs[i + 1]?.code === 2) {
      const name = pairs[i + 1].value
      const body: Pair[] = []
      let j = i + 2
      for (; j < pairs.length && !(pairs[j].code === 0 && pairs[j].value === 'ENDSEC'); j++) body.push(pairs[j])
      out.set(name, body)
      i = j
    }
  }
  return out
}

function toEntities(pairs: Pair[]): Ent[] {
  const ents: Ent[] = []
  for (const p of pairs) {
    if (p.code === 0) ents.push({ type: p.value, pairs: [] })
    else if (ents.length) ents[ents.length - 1].pairs.push(p)
  }
  return ents
}

const num = (e: Ent, code: number, def = 0): number => {
  const p = e.pairs.find(x => x.code === code)
  const v = p ? Number(p.value) : NaN
  return Number.isFinite(v) ? v : def
}
const str = (e: Ent, code: number) => e.pairs.find(x => x.code === code)?.value ?? ''

const OCS_MIRROR: Sim = { flipY: true, rot: Math.PI }
const ocs = (e: Ent, segs: Seg[]) => (num(e, 230, 1) < 0 ? simSegs(OCS_MIRROR, segs) : segs)

function polySegs(vs: { x: number; y: number; b: number }[], closed: boolean): Seg[] {
  const segs: Seg[] = []
  for (let i = 0; i + 1 < vs.length; i++) segs.push(bulgeSeg(vs[i], vs[i + 1], vs[i].b))
  if (closed && vs.length > 1) segs.push(bulgeSeg(vs[vs.length - 1], vs[0], vs[vs.length - 1].b))
  return segs.filter(s => segLength(s) > 1e-9)
}

function polylineFromPts(pts: Pt[]): Seg[] {
  const segs: Seg[] = []
  for (let i = 0; i + 1 < pts.length; i++) if (dist(pts[i], pts[i + 1]) > 1e-9) segs.push(line(pts[i], pts[i + 1]))
  return segs
}

function lwpolyline(e: Ent): Piece {
  const vs: { x: number; y: number; b: number }[] = []
  for (const p of e.pairs) {
    if (p.code === 10) vs.push({ x: Number(p.value), y: 0, b: 0 })
    else if (p.code === 20 && vs.length) vs[vs.length - 1].y = Number(p.value)
    else if (p.code === 42 && vs.length) vs[vs.length - 1].b = Number(p.value)
  }
  const closed = (num(e, 70) & 1) === 1
  return { segs: ocs(e, polySegs(vs, closed)), closed }
}

function bspline(ctrl: Pt[], knots: number[], p: number, w: number[]): Pt[] | null {
  const n = ctrl.length
  if (p < 1 || n <= p || knots.length !== n + p + 1) return null
  const lo = knots[p], hi = knots[n]
  if (!(hi > lo)) return null
  for (let i = 1; i < knots.length; i++) if (!(knots[i] >= knots[i - 1])) return null
  const samples = Math.min(DXF_LIMITS.splineSamples, Math.max(200, (n - p) * 64))
  const out: Pt[] = []
  let s = p
  for (let k = 0; k <= samples; k++) {
    const t = lo + ((hi - lo) * k) / samples
    while (s < n - 1 && knots[s + 1] <= t) s++
    const d = []
    for (let j = 0; j <= p; j++) {
      const c = ctrl[j + s - p], wt = w[j + s - p] ?? 1
      d.push({ x: c.x * wt, y: c.y * wt, w: wt })
    }
    for (let r = 1; r <= p; r++) {
      for (let j = p; j >= r; j--) {
        const den = knots[j + 1 + s - r] - knots[j + s - p]
        const a = den === 0 ? 0 : (t - knots[j + s - p]) / den
        d[j] = { x: (1 - a) * d[j - 1].x + a * d[j].x, y: (1 - a) * d[j - 1].y + a * d[j].y, w: (1 - a) * d[j - 1].w + a * d[j].w }
      }
    }
    out.push({ x: d[p].x / d[p].w, y: d[p].y / d[p].w })
  }
  return out
}

function spline(e: Ent, ctx: Ctx): Piece {
  const degree = num(e, 71, 3)
  if (degree > DXF_LIMITS.splineDegree) {
    ctx.badSplines++
    return { segs: [], closed: false }
  }
  const knots: number[] = [], weights: number[] = [], ctrl: Pt[] = [], fit: Pt[] = []
  for (const p of e.pairs) {
    if (p.code === 40) knots.push(Number(p.value))
    else if (p.code === 41) weights.push(Number(p.value))
    else if (p.code === 10) ctrl.push({ x: Number(p.value), y: 0 })
    else if (p.code === 20 && ctrl.length) ctrl[ctrl.length - 1].y = Number(p.value)
    else if (p.code === 11) fit.push({ x: Number(p.value), y: 0 })
    else if (p.code === 21 && fit.length) fit[fit.length - 1].y = Number(p.value)
  }
  const pts = bspline(ctrl, knots, degree, weights) ?? (fit.length > 1 ? fit : ctrl)
  const closedFlag = (num(e, 70) & 1) === 1
  if (closedFlag && pts.length > 2 && dist(pts[0], pts[pts.length - 1]) > 1e-9) pts.push(pts[0])
  return { segs: polylineFromPts(pts), closed: false }
}

function ellipse(e: Ent): Piece {
  const c = { x: num(e, 10), y: num(e, 20) }
  const M = { x: num(e, 11), y: num(e, 21) }
  const k = num(e, 40, 1)
  const m = { x: -M.y * k, y: M.x * k }
  const mod = (a: number) => ((a % TAU) + TAU) % TAU
  const t0 = mod(num(e, 41, 0))
  let t1 = mod(num(e, 42, TAU))
  if (t1 <= t0 + 1e-12) t1 += TAU
  const full = Math.abs(t1 - t0 - TAU) < 1e-6
  const n = Math.min(DXF_LIMITS.ellipseSamples, Math.max(72, Math.ceil((t1 - t0) / DEG)))
  const pts: Pt[] = []
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n
    pts.push({ x: c.x + M.x * Math.cos(t) + m.x * Math.sin(t), y: c.y + M.y * Math.cos(t) + m.y * Math.sin(t) })
  }
  if (full) pts[pts.length - 1] = pts[0]
  return { segs: polylineFromPts(pts), closed: false }
}

function entitiesToPieces(ents: Ent[], ctx: Ctx, depth: number): Piece[] {
  const out: Piece[] = []
  const push = (pc: Piece) => {
    spend(ctx.elements, pc.segs.length)
    out.push(pc)
  }
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i]
    spend(ctx.elements, 1)
    if (num(e, 67) === 1) continue
    switch (e.type) {
      case 'LINE': {
        const a = { x: num(e, 10), y: num(e, 20) }, b = { x: num(e, 11), y: num(e, 21) }
        if (dist(a, b) > 1e-9) push({ segs: [line(a, b)], closed: false })
        break
      }
      case 'ARC': {
        const s = num(e, 50) * DEG, en = num(e, 51) * DEG
        let sw = (en - s) % TAU
        if (sw <= 1e-12) sw += TAU
        push({ segs: ocs(e, [arc({ x: num(e, 10), y: num(e, 20) }, num(e, 40), s, sw)]), closed: false })
        break
      }
      case 'CIRCLE':
        push({ segs: ocs(e, [arc({ x: num(e, 10), y: num(e, 20) }, num(e, 40), 0, TAU)]), closed: true })
        break
      case 'LWPOLYLINE':
        push(lwpolyline(e))
        break
      case 'POLYLINE': {
        const flags = num(e, 70)
        const vs: { x: number; y: number; b: number }[] = []
        let j = i + 1
        for (; j < ents.length && ents[j].type === 'VERTEX'; j++) {
          const v = ents[j]
          if ((num(v, 70) & 16) === 16) continue
          vs.push({ x: num(v, 10), y: num(v, 20), b: num(v, 42) })
        }
        i = ents[j]?.type === 'SEQEND' ? j : j - 1
        if (flags & (16 | 64)) { ctx.unsupported.add('POLYFACE/MESH'); break }
        push({ segs: ocs(e, polySegs(vs, (flags & 1) === 1)), closed: (flags & 1) === 1 })
        break
      }
      case 'ELLIPSE':
        push(ellipse(e))
        break
      case 'SPLINE':
        push(spline(e, ctx))
        break
      case 'INSERT': {
        const name = str(e, 2)
        const blk = ctx.blocks.get(name)
        const sx = num(e, 41, 1), sy = num(e, 42, 1)
        if (!blk || depth >= MAX_BLOCK_DEPTH || Math.abs(Math.abs(sx) - Math.abs(sy)) > 1e-9 || sx === 0) {
          ctx.skippedBlocks.add(name || '?')
          break
        }
        const s = Math.abs(sx)
        const mirror: Sim = sx < 0 && sy < 0 ? { s, rot: Math.PI } : sx < 0 ? { s, flipY: true, rot: Math.PI } : sy < 0 ? { s, flipY: true } : { s }
        const place: Sim = { rot: num(e, 50) * DEG, tx: num(e, 10), ty: num(e, 20) }
        for (const pc of entitiesToPieces(blk.ents, ctx, depth + 1)) {
          let segs = simSegs({ tx: -blk.base.x, ty: -blk.base.y }, pc.segs)
          segs = simSegs(place, simSegs(mirror, segs))
          out.push({ segs, closed: pc.closed })          // отрезки уже учтены при раскрытии блока
        }
        break
      }
      case '3DSOLID': case 'BODY': case 'REGION': case 'SURFACE': case 'MESH': case '3DFACE':
        ctx.unsupported.add(e.type)
        break
      default:
        break
    }
  }
  return out
}

function readBlocks(pairs: Pair[] | undefined): Ctx['blocks'] {
  const blocks: Ctx['blocks'] = new Map()
  if (!pairs) return blocks
  let cur: { name: string; base: Pt; ents: Ent[] } | null = null
  for (const e of toEntities(pairs)) {
    if (e.type === 'BLOCK') cur = { name: str(e, 2), base: { x: num(e, 10), y: num(e, 20) }, ents: [] }
    else if (e.type === 'ENDBLK') { if (cur) blocks.set(cur.name, { base: cur.base, ents: cur.ents }); cur = null }
    else if (cur) cur.ents.push(e)
  }
  return blocks
}

// ---------- Сшивка отрезков в контуры ----------

function segKey(s: Seg): string {
  const r = (n: number) => Math.round(n * 100)
  const a = segStart(s), b = segEnd(s)
  const [p, q] = a.x < b.x || (a.x === b.x && a.y <= b.y) ? [a, b] : [b, a]
  const base = `${r(p.x)}:${r(p.y)}:${r(q.x)}:${r(q.y)}`
  return s.kind === 'line' ? `L${base}` : `A${base}:${r(s.c.x)}:${r(s.c.y)}:${r(s.r)}`
}

function chainPieces(pieces: Piece[], tol: number, work: Meter): { loops: Seg[][]; open: Seg[][] } {
  const loops: Seg[][] = []
  const seenLoops = new Set<string>()
  const seenSegs = new Set<string>()
  const open: Seg[][] = []
  const pushLoop = (segs: Seg[]) => {
    const bb = bboxOf(segs)
    const key = [bb.minX, bb.minY, bb.maxX, bb.maxY, Math.abs(signedArea(segs))].map(v => Math.round(v * 10)).join(':')
    if (!seenLoops.has(key)) { seenLoops.add(key); loops.push(segs) }
  }
  for (const pc of pieces) {
    if (!pc.segs.length) continue
    if (pc.closed) { pushLoop(pc.segs); continue }
    if (pc.segs.length === 1) {
      const k = segKey(pc.segs[0])
      if (seenSegs.has(k)) continue
      seenSegs.add(k)
    }
    open.push(pc.segs)
  }

  const cell = Math.max(1, tol * 4)
  const grid = new Map<string, number[]>()
  const key = (p: Pt) => `${Math.floor(p.x / cell)}:${Math.floor(p.y / cell)}`
  open.forEach((segs, i) => {
    for (const p of [segStart(segs[0]), segEnd(segs[segs.length - 1])]) {
      const k = key(p)
      const arr = grid.get(k)
      if (arr) arr.push(i)
      else grid.set(k, [i])
    }
  })
  const used = new Array(open.length).fill(false)
  const near = (p: Pt): { j: number; atStart: boolean } | null => {
    const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell)
    let best: { j: number; atStart: boolean; d: number } | null = null
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const cellIds = grid.get(`${cx + dx}:${cy + dy}`)
      if (!cellIds) continue
      spend(work, cellIds.length)
      for (const j of cellIds) {
        if (used[j]) continue
        const segs = open[j]
        const ds = dist(p, segStart(segs[0])), de = dist(p, segEnd(segs[segs.length - 1]))
        if (ds <= tol && (!best || ds < best.d)) best = { j, atStart: true, d: ds }
        if (de <= tol && (!best || de < best.d)) best = { j, atStart: false, d: de }
      }
    }
    return best
  }
  const reversed = (segs: Seg[]) => segs.slice().reverse().map(reverseSeg)
  const closes = (chain: Seg[]) => {
    const len = chain.reduce((a, s) => a + segLength(s), 0)
    return len > tol * 4 && dist(segEnd(chain[chain.length - 1]), segStart(chain[0])) <= tol && (chain.length > 1 || chain[0].kind === 'arc')
  }

  const openOut: Seg[][] = []
  for (let i = 0; i < open.length; i++) {
    if (used[i]) continue
    used[i] = true
    let chain = open[i].slice()
    let closed = closes(chain)
    while (!closed) {
      const m = near(segEnd(chain[chain.length - 1]))
      if (!m) break
      used[m.j] = true
      chain = chain.concat(m.atStart ? open[m.j] : reversed(open[m.j]))
      closed = closes(chain)
    }
    while (!closed) {
      const m = near(segStart(chain[0]))
      if (!m) break
      used[m.j] = true
      chain = (m.atStart ? reversed(open[m.j]) : open[m.j]).concat(chain)
      closed = closes(chain)
    }
    if (closed) {
      const last = chain[chain.length - 1]
      if (last.kind === 'line') chain[chain.length - 1] = line(last.a, segStart(chain[0]))
      pushLoop(chain)
    } else openOut.push(chain)
  }
  return { loops, open: openOut }
}

// ---------- Разбор ----------

type Loop = { segs: Seg[]; area: number; poly: Pt[] }

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

const roundBox = (b: BBox): BBox => ({ minX: round(b.minX), minY: round(b.minY), maxX: round(b.maxX), maxY: round(b.maxY) })
const roundPt = (p: Pt): Pt => ({ x: round(p.x), y: round(p.y) })

export function parseDxf(text: string, opts: ParseDxfOptions = {}): PartGeometry {
  const name = opts.name ?? 'Деталь из DXF'
  const isBinary = text.startsWith('AutoCAD Binary DXF')
  const pairs = isBinary ? [] : readPairs(text)
  const secs = sections(pairs)

  const header = secs.get('HEADER') ?? []
  const iu = header.findIndex(p => p.code === 9 && p.value === '$INSUNITS')
  const rawUnits = iu >= 0 && header[iu + 1]?.code === 70 ? Number(header[iu + 1].value) : 0
  const insunits = Number.isFinite(rawUnits) ? rawUnits : 0
  const detected: PartGeometry['units']['detected'] = INSUNITS[insunits] ?? 'unknown'
  const applied: DxfUnit = opts.units ?? (detected === 'unknown' ? 'mm' : detected)
  const units = { detected, applied, factorToMm: DXF_UNIT_TO_MM[applied] }

  const geomBox = (issues: DfmIssue[]) => buildPart({ source: 'dxf', name, units, outer: null, holes: [], cutouts: [], issues })
  if (badNumber(secs.get('ENTITIES') ?? []) || badNumber(secs.get('BLOCKS') ?? [])) {
    return geomBox([{ code: 'bad_numbers', level: 'hard', message: 'В чертеже есть нечисловые или бесконечные координаты (или числа больше миллиарда). Пересохраните DXF из CAD-программы и загрузите снова.' }])
  }
  try {
    return parseEntities(secs, isBinary, name, units, insunits, opts)
  } catch (e) {
    if (!(e instanceof TooComplex)) throw e
    return geomBox([{
      code: 'too_complex', level: 'hard',
      message: 'Чертёж слишком сложный для разбора: слишком много объектов, вложенных блоков или контуров для одной стеклянной детали. Оставьте в файле только контур детали, отверстия и вырезы (без штриховки, текста и рамки) и загрузите снова.',
    }])
  }
}

function parseEntities(secs: Map<string, Pair[]>, isBinary: boolean, name: string, units: PartGeometry['units'], insunits: number, opts: ParseDxfOptions): PartGeometry {
  const issues: DfmIssue[] = []
  const { detected, applied, factorToMm: factor } = units
  if (!opts.units && detected === 'unknown' && insunits !== 0) {
    issues.push({ code: 'units_unsupported', level: 'soft', message: `В файле указаны единицы с кодом ${insunits} (не мм, см, м, дюймы или футы). Считаем в миллиметрах — подтвердите единицы.` })
  }

  const ctx: Ctx = { blocks: readBlocks(secs.get('BLOCKS')), skippedBlocks: new Set(), unsupported: new Set(), badSplines: 0, elements: { left: DXF_LIMITS.elements } }
  const geomWork: Meter = { left: DXF_LIMITS.geomWork }
  const inside = (p: Pt, poly: Pt[]) => {
    spend(geomWork, poly.length)
    return pointInPoly(p, poly)
  }
  const pieces = entitiesToPieces(toEntities(secs.get('ENTITIES') ?? []), ctx, 0)
    .map(pc => ({ ...pc, segs: factor === 1 ? pc.segs : simSegs({ s: factor }, pc.segs) }))
  if (ctx.badSplines) {
    issues.push({ code: 'unsupported_entities', level: 'soft', message: `Сплайн степени выше ${DXF_LIMITS.splineDegree} пропущен (${ctx.badSplines} шт.): такие кривые не читаем. Перестройте кривую с меньшей степенью или дугами.` })
  }
  if (ctx.skippedBlocks.size) {
    issues.push({ code: 'blocks_ignored', level: 'soft', message: `Блоки пропущены (${[...ctx.skippedBlocks].join(', ')}): неравномерный масштаб или нет описания. Разбейте блоки (EXPLODE) и загрузите снова, если в них часть детали.` })
  }
  if (ctx.unsupported.size) {
    issues.push({ code: 'unsupported_entities', level: 'soft', message: `Объёмные объекты (${[...ctx.unsupported].join(', ')}) пропущены: нужен плоский чертёж контура детали.` })
  }

  const { loops: rawLoops, open } = chainPieces(pieces, CHAIN_TOL_MM, { left: DXF_LIMITS.chainWork })
  if (rawLoops.length > DXF_LIMITS.contours) throw new TooComplex()

  if (isBinary || (!rawLoops.length && !open.length)) {
    issues.push({
      code: 'empty_drawing', level: 'hard',
      message: isBinary ? 'Двоичный DXF не читается. Сохраните чертёж как ASCII DXF (R12 или новее).' : 'В файле нет контура детали: ни линий, ни дуг, ни полилиний.',
    })
    return buildPart({ source: 'dxf', name, units, outer: null, holes: [], cutouts: [], issues })
  }

  let loops: Loop[] = rawLoops
    .map(segs => ({ segs, area: Math.abs(signedArea(segs)), poly: tessellate(segs, true, 0.05) }))
    .filter(l => l.area > 1e-6)
    .sort((a, b) => b.area - a.area)

  let rotatedDeg = 0
  if (loops.length) {
    const info = analyzeShape(loops[0].segs)
    if (info.shape === 'rect' && info.rectAngle !== undefined) {
      let a = info.rectAngle % (Math.PI / 2)
      if (a > Math.PI / 4) a -= Math.PI / 2
      if (a <= -Math.PI / 4) a += Math.PI / 2
      if (Math.abs(a) > 0.01 * DEG) {
        rotatedDeg = a / DEG
        loops = loops.map(l => {
          const segs = simSegs({ rot: -a }, l.segs)
          return { segs, area: l.area, poly: tessellate(segs, true, 0.05) }
        })
      }
    }
  }

  const allBox = bboxOfPts([...loops.flatMap(l => l.poly), ...open.flatMap(o => tessellate(o, false, 0.05))])
  const frameBox = loops.length ? bboxOf(loops[0].segs) : allBox
  const toSvg: Sim = { flipY: true, tx: -frameBox.minX, ty: frameBox.maxY }
  const svgPt = (p: Pt) => ({ x: p.x - frameBox.minX, y: frameBox.maxY - p.y })
  const svgBox = (b: BBox): BBox => roundBox({ minX: b.minX - frameBox.minX, minY: frameBox.maxY - b.maxY, maxX: b.maxX - frameBox.minX, maxY: frameBox.maxY - b.minY })

  open.slice(0, 10).forEach(chain => {
    const end = segEnd(chain[chain.length - 1])
    issues.push({
      code: 'open_entities', level: 'hard',
      message: `Контур не замкнут: разрыв у точки (${numRu(svgPt(end).x)}; ${numRu(svgPt(end).y)}) мм. Замкните контур в CAD-программе — иначе непонятно, где стекло.`,
      at: roundPt(svgPt(end)), region: svgBox(bboxOf(chain)),
    })
  })
  if (open.length > 10) {
    issues.push({ code: 'open_entities', level: 'hard', message: `Ещё ${open.length - 10} ${plural(open.length - 10, 'незамкнутый участок', 'незамкнутых участка', 'незамкнутых участков')} контура.` })
  }

  if (!loops.length) {
    const openPathD = open.map(c => pathD(simSegs(toSvg, c), false)).join(' ')
    return buildPart({ source: 'dxf', name, units, outer: null, holes: [], cutouts: [], issues, openPathD, bboxOverride: svgBox(allBox) })
  }

  const outer = loops[0]
  const holes: HoleGeom[] = []
  const cutouts: Seg[][] = []
  const parts: Loop[] = []
  for (let i = 1; i < loops.length; i++) {
    const L = loops[i]
    const sample = L.poly[0]
    if (!inside(sample, outer.poly)) {
      if (L.poly.some(p => inside(p, outer.poly))) {
        issues.push({ code: 'contours_intersect', level: 'hard', message: 'Контуры пересекаются: внутренний контур выходит за кромку детали. Исправьте чертёж.', region: svgBox(bboxOf(L.segs)), at: roundPt(svgPt(sample)) })
      } else parts.push(L)
      continue
    }
    if (L.poly.some(p => !inside(p, outer.poly))) {
      issues.push({ code: 'contours_intersect', level: 'hard', message: 'Контуры пересекаются: внутренний контур выходит за кромку детали. Исправьте чертёж.', region: svgBox(bboxOf(L.segs)), at: roundPt(svgPt(sample)) })
      continue
    }
    const depth = loops.slice(1, i).filter(K => K.area > L.area && inside(sample, K.poly)).length
    if (depth > 0) {
      issues.push({ code: 'nested_contours', level: 'soft', message: 'Контур внутри выреза или отверстия пропущен: стекла там нет, такой контур не изготовить.', region: svgBox(bboxOf(L.segs)), at: roundPt(svgPt(sample)) })
      continue
    }
    const segs = simSegs(toSvg, L.segs)
    const circ = circleOf(segs)
    // Круг до MAX_HOLE_D_MM — отверстие (сверло); крупнее — круглый вырез, геометрия сохраняется.
    if (circ && circ.r * 2 <= MAX_HOLE_D_MM + 1e-9) holes.push({ cx: circ.c.x, cy: circ.c.y, d: circ.r * 2 })
    else cutouts.push(segs)
  }
  const topParts = parts.filter(P => !parts.some(Q => Q !== P && Q.area > P.area && inside(P.poly[0], Q.poly)))
  if (topParts.length) {
    const n = topParts.length + 1
    const region = svgBox(bboxOfPts(topParts.flatMap(p => p.poly)))
    issues.push({ code: 'multiple_parts', level: 'hard', message: `В файле ${n} ${plural(n, 'отдельная деталь', 'отдельные детали', 'отдельных деталей')}. Загрузите каждую деталь отдельным файлом — посчитаем каждую.`, region })
  }

  const outerSegs = simSegs(toSvg, outer.segs)
  // Оценка работы проверок DFM (lib/glasmen/rules.ts): каждый вырез и отверстие сверяются с
  // кромкой и друг с другом. Без предела вкладка зависнет уже после разбора.
  if (cutouts.length > DXF_LIMITS.cutouts) throw new TooComplex()
  const cutPts = cutouts.reduce((a, c) => a + tessellate(c, true, 0.05).length, 0)
  const cutSegs = cutouts.reduce((a, c) => a + c.length, 0)
  if (outerSegs.length * (cutPts + holes.length) + cutPts * cutSegs > DXF_LIMITS.geomWork) throw new TooComplex()
  const w = frameBox.maxX - frameBox.minX, h = frameBox.maxY - frameBox.minY
  if (!opts.units) {
    if (detected === 'unknown' && w < 30 && h < 30) {
      issues.push({ code: 'units_suspect', level: 'soft', message: `Деталь всего ${numRu(w)}×${numRu(h)} мм — похоже, чертёж в дюймах (тогда ${numRu(w * INCH, 0)}×${numRu(h * INCH, 0)} мм). Подтвердите единицы.` })
    } else if (Math.max(w, h) > 6000) {
      const hint = applied !== 'mm' ? `если чертёж в мм — ${numRu(w / factor, 0)}×${numRu(h / factor, 0)} мм` : 'возможно, чертёж в десятых долях мм или в других единицах'
      issues.push({ code: 'units_suspect', level: 'soft', message: `Деталь ${numRu(w, 0)}×${numRu(h, 0)} мм — больше листа стекла; ${hint}. Подтвердите единицы.` })
    }
  }

  return buildPart({ source: 'dxf', name, units, outer: outerSegs, holes, cutouts, issues, rotatedDeg: rotatedDeg || undefined })
}
