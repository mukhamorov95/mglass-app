import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { readStep, interpretStep, stepToDraft, matchCatalog, roleOfName, type StepModel, type V } from '@/lib/calc/stepImport'
import { composeLayout } from '@/lib/calc/composeLayout'
import { migrateDraft } from '@/lib/calc/composeDraft'

// 0828-2 — угловая из SolidWorks конструктора (09.10): неподвижное у стены, дверь на петлях
// стекло-стекло, боковое под 90°, штанга по верху. Числа сверены с разбором файла вручную.
const model = readStep(readFileSync('__tests__/fixtures/step/0828-2.STEP', 'utf8'))
const imp = interpretStep(model)
const hw = (re: RegExp) => imp.hardware.find(h => re.test(h.name))!

let n = 0
const uid = () => `u${++n}`

function reflectX(m: StepModel): StepModel {
  const f = (p: V): V => [-p[0], p[1], p[2]]
  const box = (b: { min: V; max: V }) => ({ min: [-b.max[0], b.min[1], b.min[2]] as V, max: [-b.min[0], b.max[1], b.max[2]] as V })
  return { root: m.root, parts: m.parts.map(p => ({ name: p.name, box: box(p.box), bodies: p.bodies.map(b => ({ ...box(b), segs: b.segs.map(([a, c]) => [f(a), f(c)] as [V, V]) })) })) }
}

describe('readStep', () => {
  it('дерево сборки: 8 деталей с названиями и размещением', () => {
    expect(model.root).toBe('0828-2')
    expect(model.parts.map(p => p.name).sort()).toEqual([
      '0828-2-3', 'Dessau-103 Петля хром', 'Dessau-103 Петля хром', 'Dessau-103 Петля хром',
      'Ручка DP-70', 'Держатель штанга A-B-ST-4201 - хром', 'Держатель штанга A-B-ST-4207', 'магнит 90 град большой',
    ].sort())
    // Три вхождения одной петли — одна деталь в разных местах сборки.
    const ys = model.parts.filter(p => p.name.startsWith('Dessau')).map(p => Math.round(p.box.min[1])).sort((a, b) => a - b)
    expect(new Set(ys).size).toBe(3)
  })
})

describe('interpretStep — 0828-2', () => {
  it('форма, стёкла, толщина и цвет', () => {
    expect(imp.shape).toBe('corner')
    expect(imp.thickness).toBe(8)
    expect(imp.finish).toBe('chrome')
    expect(imp.notes).toEqual([])
    expect(imp.panels.map(p => [p.label, p.run, p.kind, p.w, p.h, p.hinge ?? null])).toEqual([
      ['Неподвижное', 'front', 'fixed', 536, 2709, null],
      ['Дверь', 'front', 'door', 650, 2686, 'left'],
      ['Боковое', 'side', 'fixed', 935, 2709, null],
    ])
  })

  it('петли на левой кромке двери на высотах из чертежа, ручка — на правой', () => {
    const door = imp.panels.find(p => p.kind === 'door')!.key
    expect(hw(/Dessau/)).toMatchObject({ role: 'hinge', qty: 3, at: [{ panel: door, edge: 'left', pos: [227, 1986, 2436] }] })
    expect(hw(/DP-70/)).toMatchObject({ role: 'handle', qty: 1, at: [{ panel: door, edge: 'right', pos: [972] }] })
    expect(hw(/магнит/)).toMatchObject({ role: 'seal-magnet', pieces: [2686], at: [{ panel: door, edge: 'right' }] })
  })

  it('штанга из тела стёкол — кусок по длине, над обоими стёклами спереди; держатели по верху', () => {
    const [fixed, door, side] = imp.panels.map(p => p.key)
    expect(hw(/^Труба/)).toMatchObject({ name: 'Труба (штанга) 30×10', role: 'profile', pieces: [1185], at: [{ panel: fixed, edge: 'top' }, { panel: door, edge: 'top' }] })
    expect(hw(/4207/).at).toEqual([{ panel: fixed, edge: 'top', pos: [464] }])
    expect(hw(/4201/).at).toEqual([{ panel: side, edge: 'top', pos: [49] }])
  })

  it('бок слева — та же душевая зеркально, с пометкой', () => {
    const m = interpretStep(reflectX(model))
    expect(m.notes).toEqual(['Угловая с боковым стеклом слева — в конструкторе показана зеркально (бок справа)'])
    expect(m.panels).toEqual(imp.panels)
    expect(m.hardware.map(h => h.at)).toEqual(imp.hardware.map(h => h.at))
  })
})

describe('stepToDraft', () => {
  it('артикулов нет в каталоге — всё ждёт подбора, места сохранены', () => {
    const d = stepToDraft(imp, [], uid)
    expect(d.hardware).toEqual([])
    expect(d.pending.map(p => p.name)).toHaveLength(6)
    const door = d.panels.find(p => p.kind === 'door')!
    expect(d.pending.find(p => p.role === 'hinge')!.at).toEqual([{ panelId: door.id, edge: 'left', pos: [227, 1986, 2436] }])
    expect(d.kind).toBe('Душевая по чертежу 0828-2')
  })

  it('артикул в каталоге — строка состава; погонная — кусками', () => {
    const cat = [
      { base: 'DESSAU-103 BR', role: 'hinge' as const, name: 'Петля Dessau-103', stockMm: null },
      { base: 'Ш-002', role: 'profile' as const, name: 'Штанга 30×10', stockMm: 2000 },
    ]
    expect(matchCatalog('Dessau-103 Петля хром', cat)?.base).toBe('DESSAU-103 BR')
    expect(matchCatalog('Ручка DP-70', cat)).toBeNull()
    const d = stepToDraft(imp, cat, uid)
    expect(d.hardware).toHaveLength(1)
    expect(d.hardware[0]).toMatchObject({ base: 'DESSAU-103 BR', qty: '3', pieces: '' })
    expect(d.pending).toHaveLength(5)
  })

  it('схема ставит петли на высоты из чертежа; поменяли количество — по правилу', () => {
    const cat = [{ base: 'DESSAU-103 BR', role: 'hinge' as const, name: 'Петля', stockMm: null }]
    const d = stepToDraft(imp, cat, uid)
    const panels = d.panels.map(p => ({ id: p.id, label: p.label, w: +p.w, h: +p.h, run: p.run, kind: p.kind, hinge: p.hinge }))
    const row = d.hardware[0]
    const marks = (qty: number) => composeLayout(d.shape, panels, [{ id: row.id, role: row.role, stockMm: null, qty, at: row.at }]).elevation.marks.map(m => m.y)
    expect(marks(3)).toEqual([227, 1986, 2436])
    expect(marks(2)).not.toContain(1986)
  })

  it('черновик с местами и списком подбора переживает перечитывание', () => {
    const d = stepToDraft(imp, [], uid)
    const draft = { v: 2, glassId: 'clear', thickness: 8, finishId: 'chrome', shape: d.shape, panels: d.panels, hardware: d.hardware, step: { file: '0828-2.STEP', pending: d.pending } }
    const back = migrateDraft(JSON.parse(JSON.stringify(draft)))!
    expect(back.step).toEqual(draft.step)
  })
})

describe('roleOfName', () => {
  it('роль по названию детали', () => {
    expect(roleOfName('Dessau-103 Петля хром')).toBe('hinge')
    expect(roleOfName('Ручка DP-70')).toBe('handle')
    expect(roleOfName('магнит 90 град большой')).toBe('seal-magnet')
    expect(roleOfName('Держатель штанга A-B-ST-4207')).toBe('stabilizer')
    expect(roleOfName('0828-2-3')).toBeNull()
  })
})
