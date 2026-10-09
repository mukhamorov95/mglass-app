import { describe, it, expect } from 'vitest'
import { COMPOSE_TEMPLATES, applyTemplate } from '@/lib/calc/composeTemplates'
import { migrateDraft, kindFromLabel, shapeFrom } from '@/lib/calc/composeDraft'
import { composeLayout, layoutPanels, effectiveSpots, type LayoutHwIn, type LayoutPanelIn } from '@/lib/calc/composeLayout'

let n = 0
const uid = () => `id${++n}`
const tpl = (id: string) => COMPOSE_TEMPLATES.find(t => t.id === id)!

// Шаблон → вход раскладки, как его соберёт ComposePanel (роль и полоса — из каталога).
function fromTemplate(id: string) {
  const t = tpl(id)
  const a = applyTemplate(t, uid)
  const panels: LayoutPanelIn[] = a.panels.map(p => ({ ...p, w: Number(p.w), h: Number(p.h) }))
  const linear = (base: string) => /^FDP(P|A)-|^FDT-/.test(base)
  const hardware: LayoutHwIn[] = a.hardware.map((h, i) => ({
    id: `r${i}`, role: /^FDP-/.test(h.base) ? 'hinge' : /^FDR-/.test(h.base) ? 'handle' : /^FDC-/.test(h.base) ? 'stabilizer' : 'other',
    stockMm: linear(h.base) ? 2200 : null, qty: h.qty ?? 0, at: h.at, auto: h.auto,
  }))
  return { t, a, panels, hardware, layout: composeLayout(a.shape, panels, hardware) }
}

describe('черновик v1 → v2', () => {
  it('тип стекла из подписи, раздвижная — по названию изделия', () => {
    expect(kindFromLabel('Дверь 2')).toBe('door')
    expect(kindFromLabel('Дверь спереди', 'Угловая раздвижная')).toBe('slide')
    expect(kindFromLabel('Неподвижное 1')).toBe('fixed')
    expect(kindFromLabel('Стекло 1')).toBe('fixed')
  })
  it('форма: боковой ряд — угловая, шторка и walk-in — открытая, иначе ниша', () => {
    expect(shapeFrom([{ run: 'front' }, { run: 'side' }])).toBe('corner')
    expect(shapeFrom([{ run: 'front' }], 'Шторка на ванну')).toBe('walkin')
    expect(shapeFrom([{}], 'Душевая по составу')).toBe('niche')
  })
  it('черновик v1 из шаблона получает привязку того же шаблона, ничего не теряет', () => {
    const v1 = {
      v: 1, glassId: 'graphite', thickness: 8, finishId: 'black', kind: 'Две двери в нишу',
      panels: [{ id: 'a', label: 'Дверь 1', w: '450', h: '2000', run: 'front' }, { id: 'b', label: 'Дверь 2', w: '450', h: '2000', run: 'front' }],
      hardware: [
        { id: 'h1', base: 'FDP-230 BR', role: 'hinge', label: 'Петля Афродита', stockMm: null, qty: '4', pieces: '' },
        { id: 'h2', base: 'FDPP-16.1 PVC', role: 'seal', label: 'Порог', stockMm: 1000, qty: '1', pieces: '', auto: [{ run: 'front', dim: 'w' }] },
        { id: 'h3', base: 'FDR-121 SUS304', role: 'handle', label: 'Кноб руками', stockMm: null, qty: '1', pieces: '' },
      ],
    }
    const d = migrateDraft(v1)!
    expect(d.v).toBe(2)
    expect(d.shape).toBe('niche')
    expect(d.glassId).toBe('graphite')
    expect(d.panels.map(p => p.kind)).toEqual(['door', 'door'])
    expect(d.hardware.map(h => h.qty)).toEqual(['4', '1', '1'])
    expect(d.hardware[0].at).toEqual([{ panelId: 'a', edge: 'left' }, { panelId: 'b', edge: 'right' }])
    expect(d.hardware[1].auto).toEqual([{ run: 'front', dim: 'w' }])
    expect(d.hardware[2].at).toBeUndefined()   // строки не из шаблона — по умолчанию от роли
  })
  it('битое и чужое — null, v2 читается как есть, явное «убрать со схемы» сохраняется', () => {
    expect(migrateDraft(null)).toBeNull()
    expect(migrateDraft({ v: 3, panels: [], hardware: [] })).toBeNull()
    expect(migrateDraft({ v: 1, panels: 'x', hardware: [] })).toBeNull()
    const v2 = migrateDraft({ v: 2, glassId: 'clear', thickness: 10, finishId: 'chrome', shape: 'corner', panels: [{ id: 'a', label: 'Боковое', w: '900', h: '2000', run: 'side', kind: 'fixed' }], hardware: [{ id: 'h', base: 'FDT-352 SUS304', role: 'profile', label: 'Труба', stockMm: 2000, qty: '', pieces: '900', at: [] }] })!
    expect(v2.shape).toBe('corner')
    expect(v2.thickness).toBe(10)
    expect(v2.hardware[0].at).toEqual([])
  })
})

describe('раскладка стёкол', () => {
  it('угловая: спереди от стены к углу, сбоку от угла к стене, петля к неподвижному', () => {
    const { layout } = fromTemplate('corner-swing')
    const [fixed, door, side] = layout.elevation.panels
    expect([fixed.label, door.label, side.label]).toEqual(['Неподвижное', 'Дверь', 'Боковое'])
    expect([fixed.left, door.right, side.left, side.right]).toEqual(['wall', 'corner', 'corner', 'wall'])
    expect(door.hinge).toBe('left')
    expect(side.x0).toBe(1000 + 160)
    expect(layout.elevation.walls).toEqual([{ x: 0, side: 'left' }, { x: 1000 + 160 + 900, side: 'right' }])
  })
  it('две двери в нишу без явной стороны: петли к стенам, ручки в середине', () => {
    const { panels } = layoutPanels('niche', [
      { id: 'a', label: 'Дверь 1', w: 450, h: 2000, kind: 'door' },
      { id: 'b', label: 'Дверь 2', w: 450, h: 2000, kind: 'door' },
    ])
    expect(panels.map(p => [p.hinge, p.free])).toEqual([['left', 'right'], ['right', 'left']])
  })
  it('сбоку черновик хранит от стены к углу — на развёртке створка у угла первой', () => {
    const { layout } = fromTemplate('corner-sliding')
    expect(layout.elevation.panels.map(p => p.label)).toEqual(['Неподвижное спереди', 'Дверь спереди', 'Дверь сбоку', 'Неподвижное сбоку'])
    expect(layout.elevation.panels.map(p => p.free)).toEqual([null, 'right', 'left', null])
  })
  it('стекло без размера на схему не попадает, не у угловой боковой ряд — спереди', () => {
    const { panels } = layoutPanels('niche', [
      { id: 'a', label: 'Стекло', w: 0, h: 2000, kind: 'fixed' },
      { id: 'b', label: 'Боковое', w: 900, h: 2000, kind: 'fixed', run: 'side' },
    ])
    expect(panels.map(p => [p.id, p.run])).toEqual([['b', 'front']])
  })
})

describe('детали на схеме', () => {
  it('0014-6: по две петли на дверь у стен, ручки на 950 у кромок в середине', () => {
    const { layout } = fromTemplate('niche-two-doors')
    const hinges = layout.elevation.marks.filter(m => m.type === 'hinge')
    expect(hinges.map(m => [m.x, m.y])).toEqual([[0, 250], [0, 1750], [900, 250], [900, 1750]])
    const handles = layout.elevation.marks.filter(m => m.type === 'handle')
    expect(handles.map(m => [m.x, m.y])).toEqual([[450 - 70, 950], [450 + 70, 950]])
    expect(layout.elevation.unplaced).toEqual([])
  })
  it('три петли на одну дверь — на её петлевой кромке, равномерно', () => {
    const { layout } = fromTemplate('corner-swing')
    expect(layout.elevation.marks.filter(m => m.type === 'hinge').map(m => [m.x, m.y])).toEqual([[300, 250], [300, 1000], [300, 1750]])
  })
  it('две детали на одной кромке не ложатся друг на друга', () => {
    const { layout } = fromTemplate('walk-in')
    const right = layout.elevation.marks.filter(m => m.edge === 'right')
    expect(right).toHaveLength(2)
    expect(right[0].x).not.toBe(right[1].x)
  })
  it('каждая строка шаблона на схеме, кроме трубы поперёк фасада у открытых', () => {
    for (const t of COMPOSE_TEMPLATES) {
      const { layout, hardware, a } = fromTemplate(t.id)
      const hidden = hardware.filter(h => layout.elevation.unplaced.includes(h.id)).map(h => a.hardware[Number(h.id.slice(1))].base)
      expect(hidden, t.id).toEqual(t.shape === 'walkin' ? ['FDT-352 SUS304'] : [])
      for (const h of t.hardware) for (const [k] of h.at) expect(t.panels.some(p => p.key === k), `${t.id} ${h.base} → ${k}`).toBe(true)
    }
  })
  it('строка из каталога без привязки встаёт по роли; удалённое стекло из привязки выпадает', () => {
    const { panels } = layoutPanels('niche', [
      { id: 'f', label: 'Неподвижное', w: 500, h: 2000, kind: 'fixed' },
      { id: 'd', label: 'Дверь', w: 700, h: 2000, kind: 'door' },
    ])
    const row = (role: LayoutHwIn['role'], at?: LayoutHwIn['at']): LayoutHwIn => ({ id: 'x', role, stockMm: null, qty: 2, at })
    expect(effectiveSpots(row('hinge'), panels)).toEqual([{ panelId: 'd', edge: 'left' }])
    expect(effectiveSpots(row('handle'), panels)).toEqual([{ panelId: 'd', edge: 'right' }])
    expect(effectiveSpots(row('connector'), panels)).toEqual([{ panelId: 'f', edge: 'left' }])
    expect(effectiveSpots(row('other'), panels)).toEqual([])
    expect(effectiveSpots(row('hinge', [{ panelId: 'gone', edge: 'left' }, { panelId: 'd', edge: 'right' }]), panels)).toEqual([{ panelId: 'd', edge: 'right' }])
  })
  it('план: дверь открыта наружу на свою ширину от петли', () => {
    const { layout } = fromTemplate('niche-glass-door')
    expect(layout.plan.doors).toEqual([{ hinge: [500, 0], closed: [1200, 0], open: [500, -700] }])
    expect(layout.plan.fixed).toEqual([[[0, 0], [500, 0]]])
    expect(layout.plan.walls).toHaveLength(3)
  })
})
