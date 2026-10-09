import type { FinishId } from '@/lib/configurator/catalog'
import type { CompositionRole } from '@/lib/calc/composition'
import { COMPOSE_TEMPLATES, templateSpots, type AutoLen, type Run } from '@/lib/calc/composeTemplates'

// Черновик конструктора «Из деталей» (CONSTRUCTOR_ROUTE.md, К1–К3) и его перевод между версиями.
// v2 (К3) добавил то, без чего не нарисовать схему: тип стекла и сторону петель, форму душевой,
// привязку строки фурнитуры к стеклу и кромке. Цена от этих полей не зависит — их читает
// только схема. Черновик v1 переводится при чтении и не теряется: ключ v1 не трогаем.

export type PanelKind = 'fixed' | 'door' | 'slide'
// Стороны и кромки — как на фасаде, снаружи душевой. У бокового ряда «лево» — к углу.
export type Side = 'left' | 'right'
export type Edge = 'left' | 'right' | 'top' | 'bottom'
// niche — между стенами, corner — угловая (бок справа), walkin — открытая с одной стены.
export type Shape = 'niche' | 'corner' | 'walkin'
export type Spot = { panelId: string; edge: Edge }

export type PanelRow = { id: string; label: string; w: string; h: string; run?: Run; kind: PanelKind; hinge?: Side }
// auto — длины кусков от размеров стёкол (из шаблона); правка длин руками его снимает.
// at — где деталь на схеме: нет поля — по умолчанию от роли, [] — убрана со схемы явно.
export type HwRow = {
  id: string; base: string; role: CompositionRole; label: string; stockMm: number | null
  qty: string; pieces: string; auto?: AutoLen[]; at?: Spot[]
}
export type Draft = {
  v: 2; glassId: string; thickness: number; finishId: FinishId; shape: Shape
  panels: PanelRow[]; hardware: HwRow[]; kind?: string
}

export const DRAFT_KEY = 'mglass_compose_draft_v2'
export const DRAFT_KEY_V1 = 'mglass_compose_draft_v1'

const KINDS: PanelKind[] = ['fixed', 'door', 'slide']
const EDGES: Edge[] = ['left', 'right', 'top', 'bottom']
const SHAPES: Shape[] = ['niche', 'corner', 'walkin']

// В v1 тип стекла жил только в подписи: «Дверь 1», «Дверь спереди» — из кнопок и шаблонов.
export function kindFromLabel(label: string, draftKind?: string): PanelKind {
  if (!/^\s*двер/i.test(label)) return 'fixed'
  return /раздвижн/i.test(draftKind ?? '') ? 'slide' : 'door'
}

export function shapeFrom(panels: { run?: Run }[], draftKind?: string): Shape {
  if (panels.some(p => p.run === 'side')) return 'corner'
  return /шторк|walk-in|без двери/i.test(draftKind ?? '') ? 'walkin' : 'niche'
}

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const run = (v: unknown): Run | undefined => (v === 'front' || v === 'side' ? v : undefined)
const side = (v: unknown): Side | undefined => (v === 'left' || v === 'right' ? v : undefined)
const spots = (v: unknown): Spot[] | undefined =>
  Array.isArray(v)
    ? v.filter((s): s is Spot => !!s && typeof s.panelId === 'string' && EDGES.includes(s.edge)).map(s => ({ panelId: s.panelId, edge: s.edge }))
    : undefined

type Raw = Record<string, unknown>

// Любой сохранённый черновик → v2 или null. Строки с битой формой не роняют весь черновик.
export function migrateDraft(input: unknown): Draft | null {
  if (!input || typeof input !== 'object') return null
  const d = input as Raw
  if ((d.v !== 1 && d.v !== 2) || !Array.isArray(d.panels) || !Array.isArray(d.hardware)) return null
  const draftKind = typeof d.kind === 'string' ? d.kind : undefined
  const panels: PanelRow[] = (d.panels as Raw[]).filter(p => p && typeof p.id === 'string').map(p => ({
    id: p.id as string, label: str(p.label), w: str(p.w), h: str(p.h), run: run(p.run),
    kind: d.v === 2 && KINDS.includes(p.kind as PanelKind) ? (p.kind as PanelKind) : kindFromLabel(str(p.label), draftKind),
    hinge: side(p.hinge),
  }))
  const hardware: HwRow[] = (d.hardware as Raw[]).filter(h => h && typeof h.id === 'string' && typeof h.base === 'string').map(h => ({
    id: h.id as string, base: h.base as string, role: h.role as CompositionRole, label: str(h.label),
    stockMm: typeof h.stockMm === 'number' ? h.stockMm : null, qty: str(h.qty), pieces: str(h.pieces),
    ...(Array.isArray(h.auto) ? { auto: h.auto as AutoLen[] } : {}),
    ...(spots(h.at) ? { at: spots(h.at) } : {}),
  }))
  const shape = d.v === 2 && SHAPES.includes(d.shape as Shape) ? (d.shape as Shape) : shapeFrom(panels, draftKind)
  const out: Draft = {
    v: 2, glassId: str(d.glassId) || 'clear', thickness: typeof d.thickness === 'number' ? d.thickness : 8,
    finishId: (str(d.finishId) || 'chrome') as FinishId, shape, panels, hardware, ...(draftKind ? { kind: draftKind } : {}),
  }
  // Черновик v1 из шаблона: привязку берём из того же шаблона — стёкла узнаём по подписи.
  if (d.v === 1) {
    const tpl = COMPOSE_TEMPLATES.find(t => t.label === draftKind)
    if (tpl) {
      const at = templateSpots(tpl, panels)
      out.hardware = out.hardware.map(h => (at.has(h.base) ? { ...h, at: at.get(h.base) } : h))
    }
  }
  return out
}
