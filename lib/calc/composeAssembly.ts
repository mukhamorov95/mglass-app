import type { Assembly, GlassPart, HardwarePlacement, MetalPart, Niche } from '@/components/configurator/scene/assembly'
import type { CompositionRole } from '@/lib/calc/composition'
import type { Shape } from '@/lib/calc/composeDraft'
import type { Elevation, LPanel } from '@/lib/calc/composeLayout'
import { inferShape } from '@/lib/configurator/hardwareShapes'
import { partForItem } from '@/lib/configurator/parts/registry'
import { placePart, surfaces } from '@/lib/configurator/parts/mount'

// 3D собранного (CONSTRUCTOR_ROUTE.md, К4): та же раскладка, что у схемы К3, в метрах сцены
// «Сайт + 3D» (assembly.ts): фронт вдоль X, глубина вдоль Z, двери открываются наружу (−Z
// спереди, +X сбоку). Каждая деталь сцены несёт ключ `row:<id>:<n>` — касание на сцене
// возвращает строку состава. Цену сцена не знает.

const M = 0.001
const DOOR_OPEN_DEG = 32
const SLIDE_GAP = 40          // мм — створка и труба внутрь от линии стёкол
const SLIDE_OPEN = 0.28       // раздвижная приоткрыта на долю ширины
const TRAY_H = 0.06
const NICHE_DEPTH = 900
const PROFILE_W = 20          // мм — видимая ширина П-профиля

export type AssemblyRow = { id: string; role: CompositionRole; label: string; stockMm: number | null }

export const rowKey = (rowId: string, n: number | string) => `row:${rowId}:${n}`
export const rowOfKey = (key: string): string | null => /^row:([^:]+):/.exec(key)?.[1] ?? null

type XZ = [number, number]
type V3 = [number, number, number]
// Рамка полотна: u — вдоль фасада от левой кромки (мм), v — высота (мм), off — наружу (мм).
type Frame = { at: (u: number, v: number, off?: number) => V3; dir: XZ; out: XZ; rotY: number }

const rotYOf = (d: XZ) => Math.atan2(-d[1], d[0])

function frames(p: LPanel, Wf: number, sideStart: number, doorOpen: boolean): { closed: Frame; live: Frame } {
  const L: XZ = p.run === 'side' ? [Wf, p.x0 - sideStart] : [p.x0, 0]
  const d: XZ = p.run === 'side' ? [0, 1] : [1, 0]
  const n: XZ = p.run === 'side' ? [1, 0] : [0, -1]
  const make = (o: XZ, dir: XZ, out: XZ, u0: number): Frame => ({
    at: (u, v, off = 0) => [(o[0] + (u - u0) * dir[0] + off * out[0]) * M, v * M, (o[1] + (u - u0) * dir[1] + off * out[1]) * M],
    dir, out, rotY: rotYOf(dir),
  })
  const closed = make(L, d, n, 0)
  if (p.kind === 'door' && p.hinge) {
    const phi = ((doorOpen ? DOOR_OPEN_DEG : 0) * Math.PI) / 180
    const sg = p.hinge === 'left' ? 1 : -1
    const hu = p.hinge === 'left' ? 0 : p.w
    const H: XZ = [L[0] + hu * d[0], L[1] + hu * d[1]]
    const d2: XZ = [d[0] * Math.cos(phi) + sg * n[0] * Math.sin(phi), d[1] * Math.cos(phi) + sg * n[1] * Math.sin(phi)]
    const n2: XZ = [n[0] * Math.cos(phi) - sg * d[0] * Math.sin(phi), n[1] * Math.cos(phi) - sg * d[1] * Math.sin(phi)]
    return { closed, live: make(H, d2, n2, hu) }
  }
  if (p.kind === 'slide') {
    // Створка внутри от линии стёкол и сдвинута к неподвижному соседу — читается как раздвижная.
    const shift = doorOpen ? (p.free === 'left' ? 1 : -1) * p.w * SLIDE_OPEN : 0
    const o: XZ = [L[0] - n[0] * SLIDE_GAP + shift * d[0], L[1] - n[1] * SLIDE_GAP + shift * d[1]]
    return { closed, live: make(o, d, n, 0) }
  }
  return { closed, live: closed }
}

export function composeAssembly(shape: Shape, el: Elevation, rows: AssemblyRow[], thicknessMm: number, doorOpen = true): Assembly {
  const t = thicknessMm * M
  const front = el.panels.filter(p => p.run === 'front')
  const side = el.panels.filter(p => p.run === 'side')
  const Wf = front.reduce((s, p) => s + p.w, 0)
  const Ws = side.reduce((s, p) => s + p.w, 0)
  const sideStart = side[0]?.x0 ?? 0
  const byRow = new Map(rows.map(r => [r.id, r]))
  const fr = new Map(el.panels.map(p => [p.id, frames(p, Wf, sideStart, doorOpen)]))

  const glass: GlassPart[] = el.panels.map(p => {
    const f = fr.get(p.id)!.live
    return { key: `panel:${p.id}`, role: p.kind === 'fixed' ? 'fixed' : 'door', pos: f.at(p.w / 2, p.h / 2), size: [p.w * M, p.h * M, t], rotY: f.rotY }
  })

  // Погонное — по кромкам закрытого положения: профиль и труба держатся за стены и пол,
  // с дверью не открываются. Уплотнители (прозрачный ПВХ) на сцене не рисуем.
  const metal: MetalPart[] = []
  const lineN = new Map<string, number>()
  for (const ln of el.lines) {
    const row = byRow.get(ln.rowId)
    if (!row || row.role !== 'profile') continue
    const p = el.panels.find(x => x.id === ln.panelId)!
    const f = fr.get(p.id)!.closed
    const n = lineN.get(row.id) ?? 0
    lineN.set(row.id, n + 1)
    const key = rowKey(row.id, `m${n}`)
    const tube = /труб/i.test(row.label)
    if (ln.edge === 'left' || ln.edge === 'right') {
      const u = ln.edge === 'left' ? 0 : p.w
      metal.push({ key, kind: 'post', pos: f.at(u, p.h / 2), size: [PROFILE_W * M, p.h * M, 0.018], rotY: f.rotY })
    } else if (tube) {
      // Труба 30×10 «на пузе» у верха, внутрь от стёкол — как у моделей.
      metal.push({ key, kind: 'rail', pos: f.at(p.w / 2, p.h - 20, -SLIDE_GAP), size: [p.w * M, 0.010, 0.030], rotY: f.rotY })
    } else {
      const y = ln.edge === 'top' ? p.h - 6 : 6
      metal.push({ key, kind: 'profile', pos: f.at(p.w / 2, y), size: [p.w * M, 0.0125, 0.018], rotY: f.rotY })
    }
  }

  const hardware: HardwarePlacement[] = []
  const markN = new Map<string, number>()
  for (const m of el.marks) {
    const row = byRow.get(m.rowId)
    if (!row) continue
    const p = el.panels.find(x => x.id === m.panelId)!
    const f = fr.get(p.id)!.live
    const n = markN.get(row.id) ?? 0
    markN.set(row.id, n + 1)
    const key = rowKey(row.id, n)
    const u = m.x - p.x0
    const vertical = m.edge === 'left' || m.edge === 'right'
    if (m.type === 'hinge') {
      const ue = m.edge === 'right' ? p.w : 0
      const spec = partForItem(row.label, 'hinge')
      const away: XZ = m.edge === 'right' ? f.dir : [-f.dir[0], -f.dir[1]]
      const placed = spec?.mount.on === 'glass-edge' ? placePart(spec, surfaces.glassEdge(f.at(ue, m.y), away, thicknessMm)) : null
      if (placed?.ok) { hardware.push({ key, model: 'balge', part: spec!.id, pos: placed.placement.pos, rotY: placed.placement.rotY }); continue }
      const sh = inferShape(row.label)
      const shapeId = sh === 'hinge-wall' ? 'hinge-wall' : 'hinge-glass'
      hardware.push({ key, model: 'balge', shape: shapeId, pos: f.at(ue, m.y), rotY: f.rotY + (shapeId === 'hinge-wall' && m.edge === 'right' ? Math.PI : 0) })
    } else if (m.type === 'handle') {
      const spec = partForItem(row.label, 'handle')
      if (spec?.mount.on === 'glass-face') {
        const r = placePart(spec, surfaces.glassFace(f.at(u, m.y), f.out, f.dir, thicknessMm, 0, m.y * M))
        if (r.ok) {
          hardware.push({ key, model: 'sd210', part: spec.id, pos: r.placement.pos, rotY: r.placement.rotY })
          if (r.placement.mirror) hardware.push({ key: `${key}b`, model: 'sd210', part: spec.id, mirrorOf: key, pos: r.placement.mirror.pos, rotY: r.placement.mirror.rotY })
          continue
        }
      }
      const sh = inferShape(row.label)
      hardware.push({ key, model: sh === 'handle-inset' ? 'kupe' : 'sd210', shape: sh.startsWith('handle') ? sh : 'handle-bar', pos: f.at(u, m.y), rotY: f.rotY })
    } else if (m.type === 'connector') {
      hardware.push({ key, model: 'kp006', shape: 'mount-glass', pos: f.at(u, m.y), rotY: f.rotY })
    } else if (m.type === 'mount') {
      const atWall = vertical && (m.edge === 'left' ? p.left : p.right) === 'wall'
      hardware.push({ key, model: atWall ? 'kp002' : 'kp006', flatTube: true, pos: f.at(u, p.h - 20, -SLIDE_GAP), rotY: f.rotY + (atWall && m.edge === 'left' ? Math.PI : 0) })
    } else {
      // Прочее — только то, что узнаётся по названию; комплект «система» целиком не рисуем.
      const t2 = row.label.toLowerCase()
      const model: HardwarePlacement['model'] | null = /ролик|каретк/.test(t2) ? 'roller' : /заглушк/.test(t2) ? 'cap' : /соедин/.test(t2) ? 'connector' : null
      if (model) hardware.push({ key, model, pos: f.at(u, model === 'roller' ? p.h - 60 : m.y, model === 'roller' ? -SLIDE_GAP : 0), rotY: f.rotY })
    }
  }

  const H = Math.max(0, ...el.panels.map(p => p.h))
  const depth = side.length ? Ws : NICHE_DEPTH
  const niche: Niche = {
    w: Wf * M, depth: depth * M, wallH: Math.max(2.2, H * M + 0.25), trayH: TRAY_H,
    walls: shape === 'niche' ? { back: true, left: true, right: true } : { back: true, left: true, right: false },
  }
  return { glass, metal, hardware, niche, bounds: { w: Wf * M, d: depth * M, h: H * M }, center: [(Wf * M) / 2, (H * M) / 2, (depth * M) / 2] }
}
