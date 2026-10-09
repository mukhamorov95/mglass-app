import type { FinishId } from '@/lib/configurator/catalog'
import type { CompositionRole } from '@/lib/calc/composition'
import type { CatalogModel } from '@/lib/calc/compositionCatalog'
import type { Edge, HwRow, PanelKind, PanelRow, Shape, Side, Spot, StepPending } from '@/lib/calc/composeDraft'
import type { Run } from '@/lib/calc/composeTemplates'

// Импорт сборки SolidWorks (STEP AP214) в конструктор (CONSTRUCTOR_ROUTE.md, К8). Разбор
// текстовый, без CAD-библиотеки: дерево сборки, размещения деталей и точки рёбер. Стекло —
// тонкое тело, комната (стены, пол) — крупные тела, фурнитура — детали сборки по названию.
// Цены здесь нет: импорт даёт состав и где что стоит, считает расчёт по составу.

export type V = [number, number, number]
type Frame = { o: V; x: V; y: V; z: V }
export type Box = { min: V; max: V }
export type StepBody = Box & { segs: [V, V][] }
export type StepPart = { name: string; box: Box; bodies: StepBody[] }
export type StepModel = { root: string; parts: StepPart[] }

const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (a: V): V => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
const ID: Frame = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }
const rot = (f: Frame, v: V): V => add(mul(f.x, v[0]), add(mul(f.y, v[1]), mul(f.z, v[2])))
const apply = (f: Frame, p: V): V => add(f.o, rot(f, p))
const compose = (a: Frame, b: Frame): Frame => ({ o: apply(a, b.o), x: rot(a, b.x), y: rot(a, b.y), z: rot(a, b.z) })
// Обратная к ортонормированной рамке: столбцы новой — строки старой.
function invert(f: Frame): Frame {
  const inv: Frame = { o: [0, 0, 0], x: [f.x[0], f.y[0], f.z[0]], y: [f.x[1], f.y[1], f.z[1]], z: [f.x[2], f.y[2], f.z[2]] }
  inv.o = mul(rot(inv, f.o), -1)
  return inv
}

// ── Чтение файла ──

function entities(text: string): Map<number, string> {
  const from = text.indexOf('DATA;')
  const to = text.lastIndexOf('ENDSEC;')
  const body = from >= 0 ? text.slice(from + 5, to > from ? to : undefined) : text
  const out = new Map<number, string>()
  let quoted = false, start = 0
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c === "'") { if (quoted && body[i + 1] === "'") { i++; continue } quoted = !quoted; continue }
    if (quoted || c !== ';') continue
    const m = /^\s*#(\d+)\s*=\s*([\s\S]*)$/.exec(body.slice(start, i))
    if (m) out.set(+m[1], m[2].replace(/\s+/g, ' ').trim())
    start = i + 1
  }
  return out
}

const typeOf = (e: string) => /^([A-Z0-9_]+)\s*\(/.exec(e)?.[1] ?? 'COMPLEX'
const refsOf = (e: string) => Array.from(e.matchAll(/#(\d+)/g), m => +m[1])
const decode = (s: string) => s.replace(/''/g, "'")
  .replace(/\\X2\\([0-9A-Fa-f]+)\\X0\\/g, (_, h: string) => (h.match(/.{4}/g) ?? []).map(c => String.fromCharCode(parseInt(c, 16))).join(''))
const nameOf = (e: string) => decode(/'((?:[^']|'')*)'/.exec(e)?.[1] ?? '').trim()
const numsOf = (e: string) => Array.from(e.slice(e.indexOf(',') + 1).matchAll(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[Ee][-+]?\d+)?/g), m => +m[0])
const argsOf = (e: string) => e.slice(e.indexOf('(') + 1, e.lastIndexOf(')')).split(',').map(s => s.trim())

// Единица длины файла → миллиметры. SolidWorks по умолчанию пишет миллиметры.
function unitScale(text: string): number {
  if (/LENGTH_UNIT[^;]*SI_UNIT\s*\(\s*\.MILLI\.\s*,\s*\.METRE\.\s*\)/.test(text)) return 1
  if (/LENGTH_UNIT[^;]*SI_UNIT\s*\(\s*\.CENTI\.\s*,\s*\.METRE\.\s*\)/.test(text)) return 10
  if (/LENGTH_UNIT[^;]*SI_UNIT\s*\(\s*\$\s*,\s*\.METRE\.\s*\)/.test(text)) return 1000
  if (/CONVERSION_BASED_UNIT\s*\(\s*'INCH'/i.test(text)) return 25.4
  return 1
}

export function readStep(text: string): StepModel {
  const E = entities(text)
  const T = new Map<number, string>()
  for (const [id, e] of E) T.set(id, typeOf(e))
  const k = unitScale(text)
  const all = (t: string) => [...E].filter(([id]) => T.get(id) === t)

  const product = new Map(all('PRODUCT').map(([id, e]) => [id, nameOf(e)]))
  const formation = new Map<number, number>()
  for (const [id, e] of E) if (T.get(id)!.startsWith('PRODUCT_DEFINITION_FORMATION')) formation.set(id, refsOf(e).at(-1)!)
  const pdName = new Map<number, string>()
  for (const [id, e] of all('PRODUCT_DEFINITION')) pdName.set(id, product.get(formation.get(refsOf(e)[0]) ?? -1) ?? '')
  const nauo = all('NEXT_ASSEMBLY_USAGE_OCCURRENCE').map(([id, e]) => { const r = refsOf(e); return { id, parent: r[0], child: r[1] } })
  const pdsDef = new Map<number, number>()
  for (const [id, e] of all('PRODUCT_DEFINITION_SHAPE')) pdsDef.set(id, refsOf(e)[0])
  const repsOfPd = new Map<number, number[]>()
  for (const [, e] of all('SHAPE_DEFINITION_REPRESENTATION')) {
    const [pds, rep] = refsOf(e)
    const d = pdsDef.get(pds)
    if (d != null) repsOfPd.set(d, [...(repsOfPd.get(d) ?? []), rep])
  }
  const related = new Map<number, number[]>()
  for (const [, e] of all('SHAPE_REPRESENTATION_RELATIONSHIP')) {
    const [a, b] = refsOf(e)
    related.set(a, [...(related.get(a) ?? []), b])
    related.set(b, [...(related.get(b) ?? []), a])
  }

  const point = (i: number): V => {
    const n = numsOf(E.get(i) ?? '')
    return n.length >= 3 ? [n[n.length - 3] * k, n[n.length - 2] * k, n[n.length - 1] * k] : [(n[0] ?? 0) * k, (n[1] ?? 0) * k, 0]
  }
  const direction = (i: number): V => { const n = numsOf(E.get(i) ?? ''); return unit([n[n.length - 3] ?? 0, n[n.length - 2] ?? 0, n[n.length - 1] ?? 1]) }
  const ref = (s?: string) => (s && s.startsWith('#') ? +s.slice(1) : null)
  function axis(i: number): Frame {
    const e = E.get(i)
    if (!e || T.get(i) !== 'AXIS2_PLACEMENT_3D') return ID
    const a = argsOf(e)
    const o = point(ref(a[1]) ?? -1)
    const zr = ref(a[2]), xr = ref(a[3])
    const z: V = zr != null ? direction(zr) : [0, 0, 1]
    const x0: V = xr != null ? direction(xr) : [1, 0, 0]
    const x = unit(sub(x0, mul(z, dot(x0, z))))
    return { o, x, y: cross(z, x), z }
  }
  // Размещение детали в родительской сборке: из рамки детали в рамку сборки.
  const placement = new Map<number, Frame>()
  for (const [, e] of all('CONTEXT_DEPENDENT_SHAPE_REPRESENTATION')) {
    const [rel, pds] = refsOf(e)
    const n = pdsDef.get(pds)
    const idt = refsOf(E.get(rel) ?? '').find(r => T.get(r) === 'ITEM_DEFINED_TRANSFORMATION')
    if (n == null || idt == null) continue
    const [a1, a2] = refsOf(E.get(idt)!)
    placement.set(n, compose(axis(a1), invert(axis(a2))))
  }

  // Рёбра детали: каркас (ломаные B-сплайнов), рёбра тел (концы EDGE_CURVE).
  const STOP = /^(AXIS2_PLACEMENT_3D|AXIS1_PLACEMENT|DIRECTION|VECTOR|CARTESIAN_POINT)$|_CONTEXT$|UNIT|UNCERTAINTY|STYLE|COLOUR|^PRESENTATION/
  function segmentsOf(pd: number): [V, V][] {
    const reps = new Set<number>()
    const queue = [...(repsOfPd.get(pd) ?? [])]
    while (queue.length) { const r = queue.pop()!; if (reps.has(r)) continue; reps.add(r); queue.push(...(related.get(r) ?? [])) }
    const segs: [V, V][] = []
    const seen = new Set<number>()
    const stack = [...reps]
    const chain = (ids: number[]) => { const p = ids.filter(r => T.get(r) === 'CARTESIAN_POINT').map(point); for (let i = 1; i < p.length; i++) segs.push([p[i - 1], p[i]]) }
    while (stack.length) {
      const id = stack.pop()!
      if (seen.has(id)) continue
      seen.add(id)
      const e = E.get(id)
      const t = T.get(id)
      if (!e || !t || STOP.test(t)) continue
      if (t === 'COMPLEX') {
        if (/REPRESENTATION_RELATIONSHIP|UNIT|CONTEXT/.test(e)) continue
        if (/B_SPLINE_CURVE/.test(e)) { chain(refsOf(e)); continue }
      }
      if (t.startsWith('B_SPLINE_CURVE') || t === 'POLYLINE') { chain(refsOf(e)); continue }
      if (t === 'EDGE_CURVE') {
        const [v1, v2, curve] = refsOf(e)
        const at = (v: number) => point(refsOf(E.get(v) ?? '')[0] ?? -1)
        segs.push([at(v1), at(v2)])
        if (curve != null && (T.get(curve) ?? '').startsWith('B_SPLINE_CURVE')) stack.push(curve)
        continue
      }
      for (const r of refsOf(e)) if (!reps.has(r) || r === id) stack.push(r)
    }
    return segs
  }

  const children = new Map<number, typeof nauo>()
  for (const n of nauo) children.set(n.parent, [...(children.get(n.parent) ?? []), n])
  const isChild = new Set(nauo.map(n => n.child))
  const roots = [...pdName.keys()].filter(pd => !isChild.has(pd))
  const cache = new Map<number, [V, V][]>()
  const parts: StepPart[] = []
  function emit(pd: number, f: Frame) {
    if (!cache.has(pd)) cache.set(pd, segmentsOf(pd))
    const local = cache.get(pd)!
    if (!local.length) return
    parts.push({ name: pdName.get(pd) ?? '', ...splitBodies(local.map(([a, b]) => [apply(f, a), apply(f, b)] as [V, V])) })
  }
  function walk(pd: number, f: Frame, depth: number) {
    const kids = children.get(pd)
    if (!kids || depth > 12) { emit(pd, f); return }
    for (const n of kids) walk(n.child, compose(f, placement.get(n.id) ?? ID), depth + 1)
  }
  for (const r of roots) walk(r, ID, 0)
  const root = roots.find(r => children.has(r)) ?? roots[0]
  return { root: root != null ? pdName.get(root) ?? '' : '', parts }
}

function boxOf(pts: V[]): Box {
  const min: V = [Infinity, Infinity, Infinity], max: V = [-Infinity, -Infinity, -Infinity]
  for (const p of pts) for (let i = 0; i < 3; i++) { if (p[i] < min[i]) min[i] = p[i]; if (p[i] > max[i]) max[i] = p[i] }
  return { min, max }
}

// Тела детали — связные куски рёбер (у каркаса тел как таковых нет).
function splitBodies(segs: [V, V][]): { box: Box; bodies: StepBody[] } {
  const key = (p: V) => `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)},${Math.round(p[2] * 100)}`
  const parent = new Map<string, string>()
  const find = (a: string): string => { let r = a; while (parent.get(r) !== r) { const up = parent.get(r); if (up == null) { parent.set(r, r); break } r = up } parent.set(a, r); return r }
  for (const [a, b] of segs) { const ka = key(a), kb = key(b); if (!parent.has(ka)) parent.set(ka, ka); if (!parent.has(kb)) parent.set(kb, kb); parent.set(find(ka), find(kb)) }
  const groups = new Map<string, [V, V][]>()
  for (const s of segs) { const r = find(key(s[0])); groups.set(r, [...(groups.get(r) ?? []), s]) }
  const bodies = [...groups.values()].map(g => ({ ...boxOf(g.flat()), segs: g }))
  return { box: boxOf(segs.flat()), bodies }
}

// ── Толкование ──

export type StepSpot = { panel: string; edge: Edge; pos?: number[] }
export type StepHardware = { name: string; role: CompositionRole; qty: number; pieces?: number[]; at: StepSpot[] }
export type StepPanel = { key: string; label: string; w: number; h: number; run: Run; kind: PanelKind; hinge?: Side }
export type StepImport = {
  name: string; shape: Shape; thickness: number; finish: FinishId | null
  panels: StepPanel[]; hardware: StepHardware[]; notes: string[]
}

// Роль детали по названию в сборке. null — не фурнитура (стекло, комната) или не узнали.
export function roleOfName(name: string): CompositionRole | null {
  const s = name.toLowerCase()
  if (/петл|hinge|dessau|bilbao/.test(s)) return 'hinge'
  if (/ручк|кноб|handle|knob/.test(s)) return 'handle'
  if (/магнит|magnet/.test(s)) return 'seal-magnet'
  if (/уплотн|seal/.test(s)) return 'seal'
  if (/порог/.test(s)) return 'threshold'
  if (/держател|крепл|соедин|стабил|holder|bracket/.test(s)) return 'stabilizer'
  if (/штанг|труб|профил|tube|profile/.test(s)) return 'profile'
  if (/коннект|уголок|зажим|connector|clamp/.test(s)) return 'connector'
  if (/ролик|каретк|раздвиж|roller/.test(s)) return 'other'
  return null
}

const FINISH_WORDS: [RegExp, FinishId][] = [
  [/матов\S* розов|brrose/i, 'brrose'], [/матов\S* золот|brgold/i, 'brgold'], [/матов\S* хром|хром матов|сатин|satin/i, 'satin'],
  [/оружейн|gunmetal/i, 'gunmetal'], [/черн|чёрн|black/i, 'black'], [/бронз|bronze/i, 'bronze'], [/розов|rose/i, 'rose'],
  [/золот|gold/i, 'gold'], [/бел(ый|ая|ое)|white/i, 'white'], [/хром|chrome/i, 'chrome'],
]

const LINEAR = new Set<CompositionRole>(['seal', 'seal-hinge', 'seal-magnet', 'seal-bottom', 'threshold', 'profile'])
const UP = 1          // SolidWorks: ось Y вверх
const GLASS_T: [number, number] = [4, 13]
const WALL_TOL = 40   // мм: торец стекла у стены, если плоскость стены не дальше

type Glass = { body: StepBody; normal: 0 | 2; along: 0 | 2; plane: number; t: number; bottom: number; top: number }
const dimsOf = (b: Box): V => sub(b.max, b.min)
const centerOf = (b: Box): V => mul(add(b.min, b.max), 0.5)

function boxDistance(p: V, b: Box) {
  let s = 0
  for (let i = 0; i < 3; i++) { const d = p[i] < b.min[i] ? b.min[i] - p[i] : p[i] > b.max[i] ? p[i] - b.max[i] : 0; s += d * d }
  return Math.sqrt(s)
}

function segDist2(p: [number, number], a: [number, number], b: [number, number]) {
  const vx = b[0] - a[0], vy = b[1] - a[1]
  const l2 = vx * vx + vy * vy || 1
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / l2))
  const dx = p[0] - a[0] - t * vx, dy = p[1] - a[1] - t * vy
  return Math.sqrt(dx * dx + dy * dy)
}

export function interpretStep(m: StepModel): StepImport {
  const notes: string[] = []
  const hwParts = m.parts.map(p => ({ part: p, role: roleOfName(p.name) })).filter(x => x.role)
  const shellBodies = m.parts.filter(p => !roleOfName(p.name)).flatMap(p => p.bodies)

  // Стекло — тонкое вертикальное тело; штанга — длинное узкое; комната — крупное остальное.
  const glasses: Glass[] = []
  const bars: StepBody[] = []
  const room: StepBody[] = []
  for (const b of shellBodies) {
    const d = dimsOf(b)
    const sorted = [...d].sort((x, y) => x - y)
    const ti = d.indexOf(sorted[0])
    const isGlass = sorted[0] >= GLASS_T[0] && sorted[0] <= GLASS_T[1] && ti !== UP && d[UP] >= 300 && d[3 - UP - ti] >= 150
    if (isGlass) {
      const normal = ti as 0 | 2
      glasses.push({ body: b, normal, along: (2 - normal) as 0 | 2, plane: (b.min[normal] + b.max[normal]) / 2, t: sorted[0], bottom: b.min[UP], top: b.max[UP] })
    } else if (sorted[1] <= 60 && sorted[2] >= 300 && sorted[0] >= 3) bars.push(b)
    else if (sorted[2] >= 600) room.push(b)
  }
  if (!glasses.length) return { name: m.root, shape: 'niche', thickness: 8, finish: null, panels: [], hardware: [], notes: ['В файле не найдено ни одного стекла (тонкого тела 4–13 мм)'] }

  // Плоскости стёкол: одна нормаль и одна координата плоскости — один ряд.
  const groups: Glass[][] = []
  for (const g of glasses) {
    const grp = groups.find(x => x[0].normal === g.normal && Math.abs(x[0].plane - g.plane) < 25)
    if (grp) grp.push(g); else groups.push([g])
  }

  // Двери: стекло, к которому ближе всего ручка или магнит.
  const nearestGlass = (c: V, preferDoors?: Set<Glass>) => {
    let best: Glass | null = null, bd = Infinity
    for (const g of glasses) { const d = boxDistance(c, g.body); if (d < bd) { bd = d; best = g } }
    if (preferDoors && best && !preferDoors.has(best)) {
      for (const g of preferDoors) if (boxDistance(c, g.body) <= bd + 15) return { g, d: boxDistance(c, g.body) }
    }
    return { g: best!, d: bd }
  }
  const doors = new Set<Glass>()
  for (const { part, role } of hwParts) if (role === 'handle') doors.add(nearestGlass(centerOf(part.box)).g)
  if (!doors.size) for (const { part, role } of hwParts) if (role === 'seal-magnet') doors.add(nearestGlass(centerOf(part.box)).g)
  const slides = new Set<Glass>()
  for (const { part, role } of hwParts) if (role === 'other' && /ролик|каретк|roller/i.test(part.name)) slides.add(nearestGlass(centerOf(part.box)).g)

  const doorCount = (grp: Glass[]) => grp.filter(g => doors.has(g) || slides.has(g)).length
  const widthOf = (grp: Glass[]) => grp.reduce((s, g) => s + dimsOf(g.body)[g.along], 0)
  const ranked = [...groups].sort((a, b) => doorCount(b) - doorCount(a) || widthOf(b) - widthOf(a))
  const front = ranked[0]
  const nF = front[0].normal, aF = front[0].along
  const fMin = Math.min(...front.map(g => g.body.min[aF])), fMax = Math.max(...front.map(g => g.body.max[aF]))
  const side = ranked.slice(1).find(grp => grp[0].normal !== nF && (Math.abs(grp[0].plane - fMin) < 80 || Math.abs(grp[0].plane - fMax) < 80)) ?? null
  const extra = groups.filter(g => g !== front && g !== side)
  if (extra.length) notes.push(`Стёкол вне двух рядов: ${extra.flat().length} — не разложены`)

  // Стены в плане — верхние рёбра тел комнаты (пол и низ стен не в счёт).
  const floor = Math.min(...glasses.map(g => g.bottom))
  const H = (p: V): [number, number] => [p[0], p[2]]
  const wallSegs = room.flatMap(b => b.segs).filter(([a, c]) => a[UP] >= floor + 300 && c[UP] >= floor + 300 && Math.abs(a[UP] - c[UP]) < 1 && Math.hypot(a[0] - c[0], a[2] - c[2]) > 50)
  const atWall = (p: V) => wallSegs.some(([a, c]) => segDist2(H(p), H(a), H(c)) <= WALL_TOL)
  const frontPlane = front[0].plane
  const endAt = (c: number): V => { const p: V = [0, floor + 1000, 0]; p[nF] = frontPlane; p[aF] = c; return p }
  const wallLo = atWall(endAt(fMin)), wallHi = atWall(endAt(fMax))

  // Снаружи — сторона, противоположная комнате (боковым стёклам или стенам). Право — как видит
  // человек снаружи. Конструктор знает бок справа и стену открытой слева: иначе — зеркалим.
  const roomCenter = room.length ? centerOf(boxOf(room.flatMap(b => [b.min, b.max]))) : null
  const insideRef = side ? centerOf(boxOf(side.flatMap(g => [g.body.min, g.body.max])))[nF] : roomCenter ? roomCenter[nF] : frontPlane - 1
  const outward: V = [0, 0, 0]; outward[nF] = insideRef < frontPlane ? 1 : -1
  const inward = mul(outward, -1)
  const upV: V = [0, 0, 0]; upV[UP] = 1
  let right = cross(inward, upV)
  const leftOf = (a: number, b: number) => a * right[aF] < b * right[aF]
  if (side && leftOf(side[0].plane, (fMin + fMax) / 2)) {
    right = mul(right, -1)
    notes.push('Угловая с боковым стеклом слева — в конструкторе показана зеркально (бок справа)')
  } else if (!side && wallLo !== wallHi) {
    const [wallEnd, openEnd] = wallLo ? [fMin, fMax] : [fMax, fMin]
    if (leftOf(openEnd, wallEnd)) {
      right = mul(right, -1)
      notes.push('Открытая со стеной справа — в конструкторе стена слева (зеркально)')
    }
  }
  const uOf = (p: V) => dot(p, right)

  // Ряды: спереди слева направо снаружи, сбоку — от задней стены к углу.
  const frontSorted = [...front].sort((a, b) => uOf(centerOf(a.body)) - uOf(centerOf(b.body)))
  const sideSorted = side ? [...side].sort((a, b) => dot(centerOf(b.body), inward) - dot(centerOf(a.body), inward)) : []
  let shape: Shape
  if (side) shape = 'corner'
  else if (wallLo && wallHi) shape = 'niche'
  else {
    shape = 'walkin'
    if (!wallLo && !wallHi) notes.push('Стен у стёкол не найдено — считаю открытой')
  }
  if (side) {
    const back = sideSorted[0]
    const backPt: V = [0, floor + 1000, 0]; backPt[side[0].normal] = side[0].plane; backPt[nF] = dot(back.body.min, inward) > dot(back.body.max, inward) ? back.body.min[nF] : back.body.max[nF]
    if (!atWall(backPt)) notes.push('Боковое стекло не упирается в стену — проверьте форму')
  }

  // Локальные координаты стекла: u — от левой кромки (снаружи; у бокового — от угла), v — от низа.
  type P = { g: Glass; key: string; run: Run; u0: number; dir: V; w: number; h: number }
  const placed: P[] = []
  for (const g of frontSorted) {
    const u0 = Math.min(uOf(g.body.min), uOf(g.body.max))
    placed.push({ g, key: '', run: 'front', u0, dir: right, w: dimsOf(g.body)[aF], h: g.top - g.bottom })
  }
  for (const g of sideSorted) {
    // У бокового «лево» — к углу: u растёт от угла вглубь.
    const nearCorner = Math.min(dot(g.body.min, inward), dot(g.body.max, inward))
    placed.push({ g, key: '', run: 'side', u0: nearCorner, dir: inward, w: dimsOf(g.body)[nF], h: g.top - g.bottom })
  }
  const local = (p: P, c: V) => ({ u: dot(c, p.dir) - p.u0, v: c[UP] - p.g.bottom })

  // Подписи стёкол — по типу, сбоку с припиской.
  const count = new Map<string, number>()
  const kindOf = (g: Glass): PanelKind => (slides.has(g) ? 'slide' : doors.has(g) ? 'door' : 'fixed')
  for (const p of placed) {
    const base = p.run === 'side' ? (kindOf(p.g) === 'fixed' ? 'Боковое' : 'Дверь сбоку') : kindOf(p.g) === 'fixed' ? 'Неподвижное' : 'Дверь'
    count.set(base, (count.get(base) ?? 0) + 1)
  }
  const seenLbl = new Map<string, number>()
  for (const [i, p] of placed.entries()) {
    const base = p.run === 'side' ? (kindOf(p.g) === 'fixed' ? 'Боковое' : 'Дверь сбоку') : kindOf(p.g) === 'fixed' ? 'Неподвижное' : 'Дверь'
    const n = (seenLbl.get(base) ?? 0) + 1
    seenLbl.set(base, n)
    p.key = `g${i + 1}`
    ;(p as P & { label: string }).label = count.get(base)! > 1 ? `${base} ${n}` : base
  }
  const byGlass = new Map(placed.map(p => [p.g, p]))

  // Фурнитура: каждая деталь — к ближайшему стеклу и ближайшей его кромке; высота точная.
  const preferDoors = new Set<Glass>([...doors, ...slides])
  type Row = StepHardware & { spotMap: Map<string, StepSpot> }
  const rows = new Map<string, Row>()
  const hingeU = new Map<Glass, number[]>()
  for (const { part, role } of hwParts) {
    const c = centerOf(part.box)
    const near = nearestGlass(c, role === 'hinge' || role === 'handle' || role!.startsWith('seal') ? preferDoors : undefined)
    const name = part.name
    let row = rows.get(name)
    if (!row) { row = { name, role: role!, qty: 0, at: [], spotMap: new Map() }; rows.set(name, row) }
    row.qty++
    if (near.d > 150) { notes.push(`${name}: далеко от стёкол — без привязки`); continue }
    const p = byGlass.get(near.g)!
    const { u, v } = local(p, c)
    const dists: [Edge, number][] = [['left', Math.abs(u)], ['right', Math.abs(p.w - u)], ['bottom', Math.abs(v)], ['top', Math.abs(p.h - v)]]
    const linear = LINEAR.has(role!)
    let edge = dists.sort((a, b) => a[1] - b[1])[0][0]
    if (linear) {
      const d = dimsOf(part.box)
      edge = d[UP] >= Math.max(d[0], d[2]) ? (u < p.w / 2 ? 'left' : 'right') : (v < p.h / 2 ? 'bottom' : 'top')
      row.pieces = [...(row.pieces ?? []), Math.round(Math.max(...d))]
    }
    if (role === 'hinge') hingeU.set(near.g, [...(hingeU.get(near.g) ?? []), u])
    const k = `${p.key}:${edge}`
    let spot = row.spotMap.get(k)
    if (!spot) { spot = { panel: p.key, edge, ...(linear ? {} : { pos: [] }) }; row.spotMap.set(k, spot); row.at.push(spot) }
    if (spot.pos) spot.pos.push(Math.round(edge === 'left' || edge === 'right' ? v : u))
  }
  for (const r of rows.values()) for (const s of r.at) s.pos?.sort((a, b) => a - b)

  // Штанги и профили, начерченные телом в детали стёкол: длина — кусок, кромки — верх стёкол под ней.
  for (const b of bars) {
    const d = dimsOf(b)
    const sorted = [...d].sort((x, y) => x - y)
    const name = `Труба (штанга) ${Math.round(sorted[1])}×${Math.round(sorted[0])}`
    const at: StepSpot[] = []
    for (const p of placed) {
      const top = p.g.top
      const under = b.min[UP] - top
      if (under < -60 || under > 80) continue
      const u1 = dot(b.min, p.dir) - p.u0, u2 = dot(b.max, p.dir) - p.u0
      const overlap = Math.min(p.w, Math.max(u1, u2)) - Math.max(0, Math.min(u1, u2))
      if (overlap > 50) at.push({ panel: p.key, edge: 'top' })
    }
    const row: Row = rows.get(name) ?? { name, role: 'profile', qty: 0, at: [], spotMap: new Map() }
    row.qty++
    row.pieces = [...(row.pieces ?? []), Math.round(sorted[2])]
    for (const s of at) if (!row.at.some(x => x.panel === s.panel && x.edge === s.edge)) row.at.push(s)
    rows.set(name, row)
  }

  for (const { part } of m.parts.map(p => ({ part: p })).filter(x => !roleOfName(x.part.name))) {
    const used = part.bodies.some(b => glasses.some(g => g.body === b) || bars.includes(b) || room.includes(b))
    if (!used && part.name) notes.push(`${part.name}: не узнал, что это за деталь`)
  }

  const panels: StepPanel[] = placed.map(p => {
    const kind = kindOf(p.g)
    const hu = hingeU.get(p.g)
    const hinge: Side | undefined = kind === 'door' && hu?.length ? (hu.reduce((s, x) => s + x, 0) / hu.length < p.w / 2 ? 'left' : 'right') : undefined
    return { key: p.key, label: (p as P & { label: string }).label, w: Math.round(p.w), h: Math.round(p.h), run: p.run, kind, ...(hinge ? { hinge } : {}) }
  })
  const ts = glasses.map(g => Math.round(g.t))
  const thickness = ts.sort((a, b) => ts.filter(x => x === b).length - ts.filter(x => x === a).length)[0]
  const names = hwParts.map(x => x.part.name).join(' ')
  const finish = FINISH_WORDS.find(([re]) => re.test(names))?.[1] ?? null
  return {
    name: m.root, shape, thickness, finish, panels,
    hardware: [...rows.values()].map(r => ({ name: r.name, role: r.role, qty: r.qty, ...(r.pieces ? { pieces: r.pieces } : {}), at: r.at })), notes,
  }
}

// ── В черновик конструктора ──

export type StepCatalogItem = Pick<CatalogModel, 'base' | 'role' | 'name' | 'stockMm'> & { supplier?: CatalogModel['supplier'] }

// Артикул из названия детали: «Dessau-103 Петля хром» → Dessau-103. Слово с цифрой через дефис.
export function articlesOf(name: string): string[] {
  return (name.match(/[A-Za-zА-Яа-яЁё0-9]+(?:[-./][A-Za-zА-Яа-яЁё0-9]+)+/g) ?? []).filter(t => /\d/.test(t) && /[A-Za-zА-Яа-яЁё]/.test(t))
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-zа-яё0-9]/g, '')

// Позиция каталога по артикулу из названия; двусмысленно (тот же артикул в разных материалах) — нет.
export function matchCatalog(name: string, models: StepCatalogItem[]): StepCatalogItem | null {
  for (const a of articlesOf(name)) {
    const n = norm(a)
    if (n.length < 4) continue
    const hits = models.filter(m => norm(m.base.split(/\s+/)[0]) === n)
    if (hits.length === 1) return hits[0]
  }
  return null
}

// Деталь в строку состава: погонная позиция каталога — кусками, штучная — штуками.
export function hwRowOf(src: { qty: number; pieces?: number[]; at: Spot[] }, m: StepCatalogItem, id: string): HwRow {
  const linear = m.stockMm != null
  const qty = src.pieces?.length && !linear ? src.pieces.length : src.qty
  return {
    id, base: m.base, role: m.role, label: m.name, stockMm: m.stockMm,
    qty: String(linear ? Math.max(1, src.pieces?.length ?? 1) : qty),
    pieces: linear ? (src.pieces ?? []).join(', ') : '', at: src.at,
    ...(m.supplier === 'vetro' ? { supplier: 'vetro' as const } : {}),
  }
}

export type StepDraft = { shape: Shape; thickness: number; finishId: FinishId | null; kind: string; panels: PanelRow[]; hardware: HwRow[]; pending: StepPending[] }

export function stepToDraft(imp: StepImport, models: StepCatalogItem[], uid: () => string): StepDraft {
  const ids = new Map(imp.panels.map(p => [p.key, uid()]))
  const panels: PanelRow[] = imp.panels.map(p => ({
    id: ids.get(p.key)!, label: p.label, w: String(p.w), h: String(p.h), run: p.run, kind: p.kind, ...(p.hinge ? { hinge: p.hinge } : {}),
  }))
  const hardware: HwRow[] = []
  const pending: StepPending[] = []
  for (const h of imp.hardware) {
    const at: Spot[] = h.at.filter(s => ids.has(s.panel)).map(s => ({ panelId: ids.get(s.panel)!, edge: s.edge, ...(s.pos?.length ? { pos: s.pos } : {}) }))
    const m = matchCatalog(h.name, models)
    const src = { qty: h.qty, ...(h.pieces ? { pieces: h.pieces } : {}), at }
    if (m) hardware.push(hwRowOf(src, m, uid()))
    else pending.push({ id: uid(), name: h.name, role: h.role, ...src })
  }
  return { shape: imp.shape, thickness: imp.thickness, finishId: imp.finish, kind: `Душевая по чертежу ${imp.name}`, panels, hardware, pending }
}
