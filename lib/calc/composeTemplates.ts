// Шаблоны конструктора «Из деталей» (CONSTRUCTOR_ROUTE.md, К2): типовые душевые одним касанием.
// Какие — по архиву «Монтажей»: 961 установленная душевая 2022–2026, тип каждой определён по
// фото (montage_media.classification, разбор 29.09). Состав — фурнитура модели М… из «Прайса»
// (тот же набор, что считает вкладка «Душевые», снят с /api/calc/build 09.10), «Две двери в
// нишу» — заказ 0014-6. Погонное задано не числом, а от размеров стёкол: менеджер меняет
// размер — уплотнители, профиль и труба пересчитываются сами. Тип стекла, сторона петель и
// привязка фурнитуры к кромкам (at) — для схемы К3; цену они не меняют.

import type { Edge, PanelKind, Shape, Side, Spot } from '@/lib/calc/composeDraft'

export type Run = 'front' | 'side'
// Длина куска: размер стекла (panelId) или сумма ширин стёкол по стороне (run), плюс запас.
export type AutoLen = { panelId?: string; run?: Run; dim: 'w' | 'h'; plus?: number }

type PanelLike = { id: string; w: number; h: number; run?: Run }

export function resolveLen(l: AutoLen, panels: PanelLike[]): number {
  let v = 0
  if (l.panelId) v = panels.find(p => p.id === l.panelId)?.[l.dim] ?? 0
  else if (l.run) {
    const side = panels.filter(p => (p.run ?? 'front') === l.run)
    v = l.dim === 'w' ? side.reduce((s, p) => s + p.w, 0) : Math.max(0, ...side.map(p => p.h))
  }
  return v > 0 ? Math.round(v + (l.plus ?? 0)) : 0
}

export const resolvePieces = (lens: AutoLen[], panels: PanelLike[]) =>
  lens.map(l => resolveLen(l, panels)).filter(n => n > 0)

type TplLen = { panel?: string; run?: Run; dim: 'w' | 'h'; plus?: number }
// Порядок стёкол в ряду — от стены: спереди слева направо, сбоку от задней стены к углу.
type TplPanel = { key: string; label: string; w: number; h: number; run: Run; kind: PanelKind; hinge?: Side }
type TplSpot = [panel: string, edge: Edge]
type TplHw = { base: string; qty?: number; pieces?: TplLen[]; at: TplSpot[] }
export type ComposeTemplate = {
  id: string
  label: string
  share: string          // доля среди монтажей 2022–2026 — подпись на кнопке
  source: string         // откуда состав
  shape: Shape
  panels: TplPanel[]
  hardware: TplHw[]
}

const H = (panel: string): TplLen => ({ panel, dim: 'h' })
const W = (panel: string, plus = 0): TplLen => ({ panel, dim: 'w', plus })
const RUN = (run: Run): TplLen => ({ run, dim: 'w' })
// Кромка на фасаде снаружи: «door.left» — левая кромка двери.
const at = (...s: string[]): TplSpot[] => s.map(x => x.split('.') as TplSpot)

// Верхняя заглушка над дверью — ширина двери + 50 мм (так режет комплект модели).
export const COMPOSE_TEMPLATES: ComposeTemplate[] = [
  {
    id: 'corner-swing', label: 'Угловая распашная', share: '33 % монтажей', source: 'состав М7', shape: 'corner',
    panels: [
      { key: 'side', label: 'Боковое', w: 900, h: 2000, run: 'side', kind: 'fixed' },
      { key: 'fixed', label: 'Неподвижное', w: 300, h: 2000, run: 'front', kind: 'fixed' },
      { key: 'door', label: 'Дверь', w: 700, h: 2000, run: 'front', kind: 'door', hinge: 'left' },
    ],
    // Петля стекло-стекло на неподвижном, труба от стены к боковому стеклу (FDC-34 в углу).
    hardware: [
      { base: 'FDP-115 SUS304', qty: 3, at: at('door.left') },
      { base: 'FDR-30 AL', qty: 1, at: at('door.right') },
      { base: 'FDC-30 SUS304', qty: 1, at: at('fixed.left') },
      { base: 'FDC-35 SUS304', qty: 1, at: at('fixed.top') },
      { base: 'FDC-34 SUS304', qty: 1, at: at('side.left') },
      { base: 'FDPA-500.1 AL', pieces: [W('door', 50)], at: at('door.top') },
      { base: 'FDPP-502.8 PVC', pieces: [H('door')], at: at('door.right') },
      { base: 'FDPP-406.8 PVC', pieces: [W('door')], at: at('door.bottom') },
      { base: 'FDPP-402.8 PVC', pieces: [H('door')], at: at('door.left') },
      { base: 'FDPA-51.22 AL', pieces: [H('side'), H('fixed'), RUN('front'), RUN('side')], at: at('side.right', 'fixed.left', 'fixed.bottom', 'door.bottom', 'side.bottom') },
      { base: 'FDT-352 SUS304', pieces: [RUN('front')], at: at('fixed.top', 'door.top') },
    ],
  },
  {
    id: 'niche-glass-door', label: 'Стекло + дверь в нишу', share: 'распашные в нишу — 16 %', source: 'состав М2', shape: 'niche',
    panels: [
      { key: 'fixed', label: 'Неподвижное', w: 500, h: 2000, run: 'front', kind: 'fixed' },
      { key: 'door', label: 'Дверь', w: 700, h: 2000, run: 'front', kind: 'door', hinge: 'left' },
    ],
    hardware: [
      { base: 'FDP-115 SUS304', qty: 3, at: at('door.left') },
      { base: 'FDR-30 AL', qty: 1, at: at('door.right') },
      { base: 'FDC-30 SUS304', qty: 2, at: at('fixed.left', 'door.right') },
      { base: 'FDC-35 SUS304', qty: 1, at: at('fixed.top') },
      { base: 'FDPA-500.1 AL', pieces: [W('door', 50)], at: at('door.top') },
      { base: 'FDPP-502.8 PVC', pieces: [H('door')], at: at('door.right') },
      { base: 'FDPP-406.8 PVC', pieces: [W('door')], at: at('door.bottom') },
      { base: 'FDPP-402.8 PVC', pieces: [H('door')], at: at('door.left') },
      { base: 'FDPA-51.22 AL', pieces: [H('fixed'), H('door'), RUN('front')], at: at('fixed.left', 'door.right', 'fixed.bottom', 'door.bottom') },
      { base: 'FDT-352 SUS304', pieces: [RUN('front')], at: at('fixed.top', 'door.top') },
    ],
  },
  {
    id: 'niche-two-doors', label: 'Две двери в нишу', share: 'распашные в нишу — 16 %', source: 'заказ 0014-6', shape: 'niche',
    panels: [
      { key: 'd1', label: 'Дверь 1', w: 450, h: 2000, run: 'front', kind: 'door', hinge: 'left' },
      { key: 'd2', label: 'Дверь 2', w: 450, h: 2000, run: 'front', kind: 'door', hinge: 'right' },
    ],
    // Петли стена-стекло: по две на дверь у стен, двери сходятся в середине на магните.
    hardware: [
      { base: 'FDP-230 BR', qty: 4, at: at('d1.left', 'd2.right') },
      { base: 'FDR-90 SUS304', qty: 2, at: at('d1.right', 'd2.left') },
      { base: 'FDPP-404.8 PVC', pieces: [H('d1'), H('d2')], at: at('d1.left', 'd2.right') },
      { base: 'FDPP-503.8 PVC', pieces: [H('d1')], at: at('d1.right') },
      { base: 'FDPP-402.8 PVC', pieces: [W('d1'), W('d2')], at: at('d1.bottom', 'd2.bottom') },
      { base: 'FDPP-16.1 PVC', pieces: [RUN('front')], at: at('d1.bottom', 'd2.bottom') },
    ],
  },
  {
    id: 'bath-screen', label: 'Шторка на ванну', share: '11 % монтажей', source: 'неподвижная, состав М1', shape: 'walkin',
    panels: [{ key: 'glass', label: 'Шторка', w: 800, h: 1400, run: 'front', kind: 'fixed' }],
    // Труба уходит от свободного края к стене поперёк фасада — на виде спереди её не нарисовать.
    hardware: [
      { base: 'FDC-30 SUS304', qty: 1, at: at('glass.right') },
      { base: 'FDC-33 SUS304', qty: 1, at: at('glass.right') },
      { base: 'FDPA-51.22 AL', pieces: [H('glass'), W('glass')], at: at('glass.left', 'glass.bottom') },
      { base: 'FDT-352 SUS304', pieces: [W('glass')], at: [] },
    ],
  },
  {
    id: 'niche-sliding', label: 'Раздвижная в нишу', share: '10 % монтажей', source: 'состав М10', shape: 'niche',
    panels: [
      { key: 'fixed', label: 'Неподвижное', w: 700, h: 2000, run: 'front', kind: 'fixed' },
      { key: 'door', label: 'Дверь', w: 700, h: 2000, run: 'front', kind: 'slide' },
    ],
    hardware: [
      { base: 'FDS-1 SUS304', qty: 1, at: at('door.top') },
      { base: 'FDS-30 SUS304', qty: 2, at: at('door.top') },
      { base: 'FDPA-500.1 AL', pieces: [W('door', 50)], at: at('door.top') },
      { base: 'FDPA-51.22 AL', pieces: [H('fixed'), H('door'), RUN('front')], at: at('fixed.left', 'door.right', 'fixed.bottom', 'door.bottom') },
      { base: 'FDT-352 SUS304', pieces: [RUN('front')], at: at('fixed.top', 'door.top') },
      { base: 'FDPP-502.8 PVC', pieces: [H('door')], at: at('door.right') },
      { base: 'FDPP-407.8 PVC', pieces: [H('fixed'), H('door')], at: at('fixed.right', 'door.left') },
    ],
  },
  {
    id: 'corner-sliding', label: 'Угловая раздвижная', share: '10 % монтажей', source: 'состав М8', shape: 'corner',
    // Сбоку от задней стены к углу: неподвижное у стены, створки съезжаются к углу.
    panels: [
      { key: 'ff', label: 'Неподвижное спереди', w: 500, h: 2000, run: 'front', kind: 'fixed' },
      { key: 'fd', label: 'Дверь спереди', w: 500, h: 2000, run: 'front', kind: 'slide' },
      { key: 'sf', label: 'Неподвижное сбоку', w: 500, h: 2000, run: 'side', kind: 'fixed' },
      { key: 'sd', label: 'Дверь сбоку', w: 500, h: 2000, run: 'side', kind: 'slide' },
    ],
    hardware: [
      { base: 'FDS-1 SUS304', qty: 2, at: at('fd.top', 'sd.top') },
      { base: 'FDS-30 SUS304', qty: 4, at: at('fd.top', 'sd.top') },
      { base: 'FDPA-500.1 AL', pieces: [W('fd', 50), W('sd', 50)], at: at('fd.top', 'sd.top') },
      { base: 'FDPA-51.22 AL', pieces: [H('ff'), H('sf'), RUN('front'), RUN('side')], at: at('ff.left', 'sf.right', 'ff.bottom', 'fd.bottom', 'sd.bottom', 'sf.bottom') },
      { base: 'FDT-352 SUS304', pieces: [RUN('front'), RUN('side')], at: at('ff.top', 'fd.top', 'sd.top', 'sf.top') },
      { base: 'FDPP-502.8 PVC', pieces: [H('fd')], at: at('fd.right') },
      { base: 'FDPP-407.8 PVC', pieces: [H('ff'), H('sf')], at: at('ff.right', 'sf.left') },
    ],
  },
  {
    id: 'walk-in', label: 'Без двери (walk-in)', share: '8 % монтажей', source: 'состав М1', shape: 'walkin',
    panels: [{ key: 'glass', label: 'Стекло', w: 1000, h: 2000, run: 'front', kind: 'fixed' }],
    hardware: [
      { base: 'FDC-30 SUS304', qty: 1, at: at('glass.right') },
      { base: 'FDC-33 SUS304', qty: 1, at: at('glass.right') },
      { base: 'FDPA-51.22 AL', pieces: [H('glass'), W('glass')], at: at('glass.left', 'glass.bottom') },
      { base: 'FDT-352 SUS304', pieces: [W('glass')], at: [] },
    ],
  },
]

// Шаблон → стёкла и строки фурнитуры с ссылками на id стёкол (ключи шаблона живут только здесь).
export function applyTemplate(t: ComposeTemplate, uid: () => string) {
  const ids = new Map(t.panels.map(p => [p.key, uid()]))
  const panels = t.panels.map(p => ({
    id: ids.get(p.key)!, label: p.label, w: String(p.w), h: String(p.h), run: p.run, kind: p.kind, ...(p.hinge ? { hinge: p.hinge } : {}),
  }))
  const hardware = t.hardware.map(h => ({
    base: h.base,
    qty: h.qty,
    auto: h.pieces?.map((l): AutoLen => ({ ...(l.panel ? { panelId: ids.get(l.panel) } : { run: l.run }), dim: l.dim, ...(l.plus ? { plus: l.plus } : {}) })),
    at: h.at.map(([k, edge]): Spot => ({ panelId: ids.get(k)!, edge })),
  }))
  return { shape: t.shape, panels, hardware }
}

// Привязка шаблона к уже собранным стёклам (черновик v1 без привязки): стекло узнаём по подписи.
// Стекло переименовали или убрали — его кромки пропускаем, остальное остаётся.
export function templateSpots(t: ComposeTemplate, panels: { id: string; label: string }[]): Map<string, Spot[]> {
  const idOf = new Map<string, string>()
  for (const tp of t.panels) {
    const p = panels.find(x => x.label === tp.label)
    if (p) idOf.set(tp.key, p.id)
  }
  const out = new Map<string, Spot[]>()
  for (const h of t.hardware) {
    const s = h.at.flatMap(([k, edge]) => (idOf.has(k) ? [{ panelId: idOf.get(k)!, edge }] : []))
    // Ни одно стекло строки не нашлось — пусть встанет по умолчанию, а не пропадёт со схемы.
    if (s.length || !h.at.length) out.set(h.base, s)
  }
  return out
}
