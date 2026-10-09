// Шаблоны конструктора «Из деталей» (CONSTRUCTOR_ROUTE.md, К2): типовые душевые одним касанием.
// Какие — по архиву «Монтажей»: 961 установленная душевая 2022–2026, тип каждой определён по
// фото (montage_media.classification, разбор 29.09). Состав — фурнитура модели М… из «Прайса»
// (тот же набор, что считает вкладка «Душевые», снят с /api/calc/build 09.10), «Две двери в
// нишу» — заказ 0014-6. Погонное задано не числом, а от размеров стёкол: менеджер меняет
// размер — уплотнители, профиль и труба пересчитываются сами.

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
type TplPanel = { key: string; label: string; w: number; h: number; run: Run }
type TplHw = { base: string; qty?: number; pieces?: TplLen[] }
export type ComposeTemplate = {
  id: string
  label: string
  share: string          // доля среди монтажей 2022–2026 — подпись на кнопке
  source: string         // откуда состав
  panels: TplPanel[]
  hardware: TplHw[]
}

const H = (panel: string): TplLen => ({ panel, dim: 'h' })
const W = (panel: string, plus = 0): TplLen => ({ panel, dim: 'w', plus })
const RUN = (run: Run): TplLen => ({ run, dim: 'w' })

// Верхняя заглушка над дверью — ширина двери + 50 мм (так режет комплект модели).
export const COMPOSE_TEMPLATES: ComposeTemplate[] = [
  {
    id: 'corner-swing', label: 'Угловая распашная', share: '33 % монтажей', source: 'состав М7',
    panels: [
      { key: 'side', label: 'Боковое', w: 900, h: 2000, run: 'side' },
      { key: 'fixed', label: 'Неподвижное', w: 300, h: 2000, run: 'front' },
      { key: 'door', label: 'Дверь', w: 700, h: 2000, run: 'front' },
    ],
    hardware: [
      { base: 'FDP-115 SUS304', qty: 3 },
      { base: 'FDR-30 AL', qty: 1 },
      { base: 'FDC-30 SUS304', qty: 1 },
      { base: 'FDC-35 SUS304', qty: 1 },
      { base: 'FDC-34 SUS304', qty: 1 },
      { base: 'FDPA-500.1 AL', pieces: [W('door', 50)] },
      { base: 'FDPP-502.8 PVC', pieces: [H('door')] },
      { base: 'FDPP-406.8 PVC', pieces: [W('door')] },
      { base: 'FDPP-402.8 PVC', pieces: [H('door')] },
      { base: 'FDPA-51.22 AL', pieces: [H('side'), H('fixed'), RUN('front'), RUN('side')] },
      { base: 'FDT-352 SUS304', pieces: [RUN('front')] },
    ],
  },
  {
    id: 'niche-glass-door', label: 'Стекло + дверь в нишу', share: 'распашные в нишу — 16 %', source: 'состав М2',
    panels: [
      { key: 'fixed', label: 'Неподвижное', w: 500, h: 2000, run: 'front' },
      { key: 'door', label: 'Дверь', w: 700, h: 2000, run: 'front' },
    ],
    hardware: [
      { base: 'FDP-115 SUS304', qty: 3 },
      { base: 'FDR-30 AL', qty: 1 },
      { base: 'FDC-30 SUS304', qty: 2 },
      { base: 'FDC-35 SUS304', qty: 1 },
      { base: 'FDPA-500.1 AL', pieces: [W('door', 50)] },
      { base: 'FDPP-502.8 PVC', pieces: [H('door')] },
      { base: 'FDPP-406.8 PVC', pieces: [W('door')] },
      { base: 'FDPP-402.8 PVC', pieces: [H('door')] },
      { base: 'FDPA-51.22 AL', pieces: [H('fixed'), H('door'), RUN('front')] },
      { base: 'FDT-352 SUS304', pieces: [RUN('front')] },
    ],
  },
  {
    id: 'niche-two-doors', label: 'Две двери в нишу', share: 'распашные в нишу — 16 %', source: 'заказ 0014-6',
    panels: [
      { key: 'd1', label: 'Дверь 1', w: 450, h: 2000, run: 'front' },
      { key: 'd2', label: 'Дверь 2', w: 450, h: 2000, run: 'front' },
    ],
    hardware: [
      { base: 'FDP-230 BR', qty: 4 },
      { base: 'FDR-90 SUS304', qty: 2 },
      { base: 'FDPP-404.8 PVC', pieces: [H('d1'), H('d2')] },
      { base: 'FDPP-503.8 PVC', pieces: [H('d1')] },
      { base: 'FDPP-402.8 PVC', pieces: [W('d1'), W('d2')] },
      { base: 'FDPP-16.1 PVC', pieces: [RUN('front')] },
    ],
  },
  {
    id: 'bath-screen', label: 'Шторка на ванну', share: '11 % монтажей', source: 'неподвижная, состав М1',
    panels: [{ key: 'glass', label: 'Шторка', w: 800, h: 1400, run: 'front' }],
    hardware: [
      { base: 'FDC-30 SUS304', qty: 1 },
      { base: 'FDC-33 SUS304', qty: 1 },
      { base: 'FDPA-51.22 AL', pieces: [H('glass'), W('glass')] },
      { base: 'FDT-352 SUS304', pieces: [W('glass')] },
    ],
  },
  {
    id: 'niche-sliding', label: 'Раздвижная в нишу', share: '10 % монтажей', source: 'состав М10',
    panels: [
      { key: 'fixed', label: 'Неподвижное', w: 700, h: 2000, run: 'front' },
      { key: 'door', label: 'Дверь', w: 700, h: 2000, run: 'front' },
    ],
    hardware: [
      { base: 'FDS-1 SUS304', qty: 1 },
      { base: 'FDS-30 SUS304', qty: 2 },
      { base: 'FDPA-500.1 AL', pieces: [W('door', 50)] },
      { base: 'FDPA-51.22 AL', pieces: [H('fixed'), H('door'), RUN('front')] },
      { base: 'FDT-352 SUS304', pieces: [RUN('front')] },
      { base: 'FDPP-502.8 PVC', pieces: [H('door')] },
      { base: 'FDPP-407.8 PVC', pieces: [H('fixed'), H('door')] },
    ],
  },
  {
    id: 'corner-sliding', label: 'Угловая раздвижная', share: '10 % монтажей', source: 'состав М8',
    panels: [
      { key: 'ff', label: 'Неподвижное спереди', w: 500, h: 2000, run: 'front' },
      { key: 'fd', label: 'Дверь спереди', w: 500, h: 2000, run: 'front' },
      { key: 'sf', label: 'Неподвижное сбоку', w: 500, h: 2000, run: 'side' },
      { key: 'sd', label: 'Дверь сбоку', w: 500, h: 2000, run: 'side' },
    ],
    hardware: [
      { base: 'FDS-1 SUS304', qty: 2 },
      { base: 'FDS-30 SUS304', qty: 4 },
      { base: 'FDPA-500.1 AL', pieces: [W('fd', 50), W('sd', 50)] },
      { base: 'FDPA-51.22 AL', pieces: [H('ff'), H('sf'), RUN('front'), RUN('side')] },
      { base: 'FDT-352 SUS304', pieces: [RUN('front'), RUN('side')] },
      { base: 'FDPP-502.8 PVC', pieces: [H('fd')] },
      { base: 'FDPP-407.8 PVC', pieces: [H('ff'), H('sf')] },
    ],
  },
  {
    id: 'walk-in', label: 'Без двери (walk-in)', share: '8 % монтажей', source: 'состав М1',
    panels: [{ key: 'glass', label: 'Стекло', w: 1000, h: 2000, run: 'front' }],
    hardware: [
      { base: 'FDC-30 SUS304', qty: 1 },
      { base: 'FDC-33 SUS304', qty: 1 },
      { base: 'FDPA-51.22 AL', pieces: [H('glass'), W('glass')] },
      { base: 'FDT-352 SUS304', pieces: [W('glass')] },
    ],
  },
]

// Шаблон → стёкла и строки фурнитуры с ссылками на id стёкол (ключи шаблона живут только здесь).
export function applyTemplate(t: ComposeTemplate, uid: () => string) {
  const ids = new Map(t.panels.map(p => [p.key, uid()]))
  const panels = t.panels.map(p => ({ id: ids.get(p.key)!, label: p.label, w: String(p.w), h: String(p.h), run: p.run }))
  const hardware = t.hardware.map(h => ({
    base: h.base,
    qty: h.qty,
    auto: h.pieces?.map((l): AutoLen => ({ ...(l.panel ? { panelId: ids.get(l.panel) } : { run: l.run }), dim: l.dim, ...(l.plus ? { plus: l.plus } : {}) })),
  }))
  return { panels, hardware }
}
