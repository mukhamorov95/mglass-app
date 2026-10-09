import type { CompositionRole } from '@/lib/calc/composition'
import type { AutoLen, Run } from '@/lib/calc/composeTemplates'
import type { Edge, PanelKind, Shape, Side, Spot } from '@/lib/calc/composeDraft'

// Раскладка состава для схемы (CONSTRUCTOR_ROUTE.md, К3): фасад-развёртка снаружи и план.
// Миллиметры, фасад — y вверх от пола; план — y вглубь от линии стёкол. Ряд спереди идёт
// слева направо от стены, боковой (угловая) — за углом, от угла к задней стене.
// Ничего не считает в деньгах: только где стоит стекло и куда показать деталь.

export type End = 'wall' | 'corner' | 'free' | 'glass'
export type LayoutPanelIn = { id: string; label: string; w: number; h: number; run?: Run; kind: PanelKind; hinge?: Side }
export type LayoutHwIn = { id: string; role: CompositionRole; stockMm: number | null; qty: number; at?: Spot[]; auto?: AutoLen[] }

export type LPanel = {
  id: string; label: string; kind: PanelKind; run: Run
  hinge: Side | null           // у двери — петлевая кромка
  free: Side | null            // у двери и раздвижной — кромка ручки
  x0: number; w: number; h: number; left: End; right: End
}
export type MarkType = 'hinge' | 'handle' | 'connector' | 'mount' | 'point'
export type LMark = { rowId: string; num: number; type: MarkType; x: number; y: number; panelId: string; edge: Edge }
export type LLine = { rowId: string; num: number; x1: number; y1: number; x2: number; y2: number; panelId: string; edge: Edge }
export type Elevation = {
  panels: LPanel[]
  walls: { x: number; side: Side }[]   // стена слева или справа от x
  corner: number | null                // x середины угла между рядами
  width: number; height: number
  marks: LMark[]; lines: LLine[]
  unplaced: string[]                   // строки, которых на схеме нет
}
export type P = [number, number]
export type Plan = {
  walls: [P, P][]; fixed: [P, P][]; slides: [P, P][]
  doors: { hinge: P; closed: P; open: P }[]
  minX: number; maxX: number; minY: number; maxY: number
}

export const CORNER_GAP = 160
const NICHE_DEPTH = 900
const SLIDE_OFFSET = 50
const HANDLE_Y = 950

export function sameSpot(a: Spot, b: Spot) { return a.panelId === b.panelId && a.edge === b.edge }
const dedupe = (s: Spot[]) => s.filter((x, i) => s.findIndex(y => sameSpot(x, y)) === i)
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi))
const along = (n: number, lo: number, hi: number) => (n === 1 ? [(lo + hi) / 2] : Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1)))

// Петля по умолчанию — к соседнему неподвижному стеклу, иначе к стене на конце ряда.
function hingeOf(prev: LayoutPanelIn | undefined, next: LayoutPanelIn | undefined, left: End, right: End): Side {
  if (prev?.kind === 'fixed') return 'left'
  if (next?.kind === 'fixed') return 'right'
  if (!prev && left === 'wall') return 'left'
  if (!next && right === 'wall') return 'right'
  return 'left'
}

export function layoutPanels(shape: Shape, panels: LayoutPanelIn[]): { panels: LPanel[]; walls: Elevation['walls']; corner: number | null } {
  const ok = panels.filter(p => p.w >= 50 && p.h >= 50)
  const runOf = (p: LayoutPanelIn): Run => (shape === 'corner' ? p.run ?? 'front' : 'front')
  const front = ok.filter(p => runOf(p) === 'front')
  // Сбоку черновик хранит от задней стены к углу; на развёртке — от угла.
  const side = ok.filter(p => runOf(p) === 'side').reverse()
  const frontRight: End = shape === 'niche' ? 'wall' : side.length ? 'corner' : 'free'
  const out: LPanel[] = []
  const walls: Elevation['walls'] = []
  let x = 0
  const place = (row: LayoutPanelIn[], run: Run, left: End, right: End) => {
    row.forEach((p, i) => {
      const l: End = i === 0 ? left : 'glass'
      const r: End = i === row.length - 1 ? right : 'glass'
      const hinge = p.kind === 'door' ? p.hinge ?? hingeOf(row[i - 1], row[i + 1], l, r) : null
      // Раздвижная уходит в сторону неподвижного соседа — ручка на другой кромке.
      const free: Side | null = p.kind === 'door' ? (hinge === 'left' ? 'right' : 'left')
        : p.kind === 'slide' ? (row[i + 1]?.kind === 'fixed' && row[i - 1]?.kind !== 'fixed' ? 'left' : 'right') : null
      out.push({ id: p.id, label: p.label, kind: p.kind, run, hinge, free, x0: x, w: p.w, h: p.h, left: l, right: r })
      x += p.w
    })
  }
  if (front.length) walls.push({ x: 0, side: 'left' })
  place(front, 'front', 'wall', frontRight)
  if (front.length && frontRight === 'wall') walls.push({ x, side: 'right' })
  let corner: number | null = null
  if (side.length) {
    if (front.length) { corner = x + CORNER_GAP / 2; x += CORNER_GAP }
    place(side, 'side', front.length ? 'corner' : 'wall', 'wall')
    walls.push({ x, side: 'right' })
  }
  return { panels: out, walls, corner }
}

const wallEdges = (p: LPanel): Side[] => [...(p.left === 'wall' ? ['left' as const] : []), ...(p.right === 'wall' ? ['right' as const] : [])]
const glassEdges = (p: LPanel): Side[] => [...(p.left === 'glass' ? ['left' as const] : []), ...(p.right === 'glass' ? ['right' as const] : [])]

// Куда встаёт строка без явной привязки: от роли и от того, от каких размеров её длины.
export function defaultSpots(row: LayoutHwIn, panels: LPanel[]): Spot[] {
  const byId = new Map(panels.map(p => [p.id, p]))
  const fixed = panels.filter(p => p.kind === 'fixed')
  if (row.stockMm != null) {
    return (row.auto ?? []).flatMap((l): Spot[] => {
      if (l.panelId) {
        const p = byId.get(l.panelId)
        if (!p) return []
        if (l.dim === 'w') return [{ panelId: p.id, edge: 'bottom' }]
        return [{ panelId: p.id, edge: wallEdges(p)[0] ?? p.free ?? 'left' }]
      }
      const ps = panels.filter(p => p.run === l.run)
      return l.dim === 'w' ? ps.map(p => ({ panelId: p.id, edge: 'bottom' as const })) : ps.flatMap(p => wallEdges(p).map(edge => ({ panelId: p.id, edge })))
    })
  }
  switch (row.role) {
    case 'hinge': return panels.filter(p => p.hinge).map(p => ({ panelId: p.id, edge: p.hinge! }))
    case 'handle': return panels.filter(p => p.free).map(p => ({ panelId: p.id, edge: p.free! }))
    case 'connector': {
      const atWall = fixed.flatMap(p => wallEdges(p).map(edge => ({ panelId: p.id, edge })))
      return atWall.length ? atWall : fixed.flatMap(p => glassEdges(p).map(edge => ({ panelId: p.id, edge })))
    }
    case 'stabilizer': {
      const atWall = fixed.flatMap(p => wallEdges(p).map(edge => ({ panelId: p.id, edge })))
      return atWall.length ? atWall : fixed.slice(0, 1).map(p => ({ panelId: p.id, edge: 'top' as const }))
    }
    default: return []
  }
}

export function effectiveSpots(row: LayoutHwIn, panels: LPanel[]): Spot[] {
  const has = new Set(panels.map(p => p.id))
  return dedupe((row.at ?? defaultSpots(row, panels)).filter(s => has.has(s.panelId)))
}

const MARK: Partial<Record<CompositionRole, MarkType>> = { hinge: 'hinge', handle: 'handle', connector: 'connector', stabilizer: 'mount' }

// Штуки строки по её кромкам поровну, остаток — первым. Точки на кромке — по монтажу:
// петли и коннекторы от краёв, ручка на 950 мм, крепления трубы у верха. Точные места
// из чертежа (pos) — как есть.
function pointsOn(p: LPanel, edge: Edge, type: MarkType, n: number, slot: number, pos?: number[]): [number, number][] {
  if (edge === 'left' || edge === 'right') {
    const inward = edge === 'left' ? 1 : -1
    const ex = edge === 'left' ? p.x0 : p.x0 + p.w
    const m = Math.min(250, p.h * 0.15)
    const ys = pos ? pos.map(y => clamp(y, 0, p.h))
      : type === 'hinge' || type === 'connector' ? along(n, m, p.h - m)
      : type === 'handle' ? (n === 1 ? [clamp(HANDLE_Y, 300, p.h - 300)] : along(n, clamp(HANDLE_Y - 250, 300, p.h - 300), clamp(HANDLE_Y + 250, 300, p.h - 300)))
      : type === 'mount' ? Array.from({ length: n }, (_, i) => p.h - 70 - 110 * i)
      : along(n, p.h * 0.3, p.h * 0.7)
    const inset = type === 'hinge' ? 0 : type === 'connector' ? slot * 60 : (type === 'handle' ? 70 : 45) + slot * 60
    return ys.map(y => [ex + inward * inset, y])
  }
  const xs = pos ? pos.map(x => p.x0 + clamp(x, 0, p.w)) : along(n, p.x0 + p.w * (n === 1 ? 0 : 0.15), p.x0 + p.w * (n === 1 ? 1 : 0.85))
  const inset = 35 + slot * 60
  return xs.map(x => [x, edge === 'top' ? p.h - inset : inset])
}

export function composeLayout(shape: Shape, panelsIn: LayoutPanelIn[], hardware: LayoutHwIn[]): { elevation: Elevation; plan: Plan } {
  const { panels, walls, corner } = layoutPanels(shape, panelsIn)
  const byId = new Map(panels.map(p => [p.id, p]))
  const marks: LMark[] = []
  const lines: LLine[] = []
  const unplaced: string[] = []
  const markSlots = new Map<string, number>()
  const lineSlots = new Map<string, number>()
  hardware.forEach((row, i) => {
    const num = i + 1
    const spots = effectiveSpots(row, panels)
    if (row.stockMm != null) {
      if (!spots.length) { unplaced.push(row.id); return }
      for (const s of spots) {
        const p = byId.get(s.panelId)!
        const k = `${s.panelId}:${s.edge}`
        const slot = lineSlots.get(k) ?? 0
        lineSlots.set(k, slot + 1)
        const inset = 14 + slot * 22
        if (s.edge === 'left' || s.edge === 'right') {
          const x = s.edge === 'left' ? p.x0 + inset : p.x0 + p.w - inset
          lines.push({ rowId: row.id, num, x1: x, y1: 0, x2: x, y2: p.h, panelId: p.id, edge: s.edge })
        } else {
          const y = s.edge === 'top' ? p.h - inset : inset
          lines.push({ rowId: row.id, num, x1: p.x0, y1: y, x2: p.x0 + p.w, y2: y, panelId: p.id, edge: s.edge })
        }
      }
      return
    }
    const qty = Math.max(0, Math.round(row.qty))
    if (!qty) return
    if (!spots.length) { unplaced.push(row.id); return }
    const type = MARK[row.role] ?? 'point'
    // Места из чертежа держатся, пока штук столько же, сколько мест; поменяли количество — по правилу.
    const exact = spots.every(s => s.pos?.length) && spots.reduce((a, s) => a + s.pos!.length, 0) === qty
    spots.forEach((s, j) => {
      const n = exact ? s.pos!.length : Math.floor(qty / spots.length) + (j < qty % spots.length ? 1 : 0)
      if (!n) return
      const p = byId.get(s.panelId)!
      const k = `${s.panelId}:${s.edge}`
      const slot = type === 'hinge' ? 0 : markSlots.get(k) ?? 0
      if (type !== 'hinge') markSlots.set(k, slot + 1)
      for (const [x, y] of pointsOn(p, s.edge, type, n, slot, exact ? s.pos : undefined)) marks.push({ rowId: row.id, num, type, x, y, panelId: p.id, edge: s.edge })
    })
  })
  const last = panels[panels.length - 1]
  const elevation: Elevation = {
    panels, walls, corner, marks, lines, unplaced,
    width: last ? last.x0 + last.w : 0,
    height: Math.max(0, ...panels.map(p => p.h)),
  }
  return { elevation, plan: planOf(shape, panels) }
}

// План сверху: ряд спереди по y = 0, боковой по x = ширине ряда спереди, двери открыты наружу.
export function planOf(shape: Shape, panels: LPanel[]): Plan {
  const front = panels.filter(p => p.run === 'front')
  const side = panels.filter(p => p.run === 'side')
  const Wf = front.reduce((s, p) => s + p.w, 0)
  const Ws = side.reduce((s, p) => s + p.w, 0)
  const sx = side[0]?.x0 ?? 0
  const D = side.length ? Ws : NICHE_DEPTH
  const walls: [P, P][] = []
  const fixed: [P, P][] = []
  const slides: [P, P][] = []
  const doors: Plan['doors'] = []
  if (panels.length) {
    walls.push([[0, 0], [0, D]], [[0, D], [Math.max(Wf, side.length ? Wf : 0), D]])
    if (shape === 'niche' && front.length) walls.push([[Wf, 0], [Wf, D]])
  }
  for (const p of front) {
    const a: P = [p.x0, 0], b: P = [p.x0 + p.w, 0]
    if (p.kind === 'fixed') fixed.push([a, b])
    else if (p.kind === 'slide') slides.push([[a[0], SLIDE_OFFSET], [b[0], SLIDE_OFFSET]])
    else if (p.hinge === 'right') doors.push({ hinge: b, closed: a, open: [b[0], -p.w] })
    else doors.push({ hinge: a, closed: b, open: [a[0], -p.w] })
  }
  for (const p of side) {
    const y0 = p.x0 - sx
    const a: P = [Wf, y0], b: P = [Wf, y0 + p.w]
    if (p.kind === 'fixed') fixed.push([a, b])
    else if (p.kind === 'slide') slides.push([[Wf - SLIDE_OFFSET, a[1]], [Wf - SLIDE_OFFSET, b[1]]])
    else if (p.hinge === 'right') doors.push({ hinge: b, closed: a, open: [Wf + p.w, b[1]] })
    else doors.push({ hinge: a, closed: b, open: [Wf + p.w, a[1]] })
  }
  const pts: P[] = [...walls.flat(), ...fixed.flat(), ...slides.flat(), ...doors.flatMap(d => [d.hinge, d.closed, d.open])]
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
  return {
    walls, fixed, slides, doors,
    minX: Math.min(0, ...xs), maxX: Math.max(0, ...xs), minY: Math.min(0, ...ys), maxY: Math.max(0, ...ys),
  }
}
