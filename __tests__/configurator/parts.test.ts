import { describe, it, expect } from 'vitest'
import { validatePart } from '@/lib/configurator/parts/validate'
import { placePart, surfaces } from '@/lib/configurator/parts/mount'
import { allParts, getPart, partProblems } from '@/lib/configurator/parts/registry'
import { SD_210_L230 } from '@/lib/configurator/parts/catalog/sd-210'
import { buildFromModel } from '@/components/configurator/scene/assembly'
import { computeKitQuantities } from '@/lib/configurator/kit'
import { inferShape } from '@/lib/configurator/hardwareShapes'
import { getModel } from '@/lib/configurator/arrangement'
import type { PartSpec } from '@/lib/configurator/parts/types'

const mm = (m: number) => Math.round(m * 1000)

describe('реестр паспортов', () => {
  it('пропускает только валидные детали и не молчит о браке', () => {
    const { rejected, dupes } = partProblems()
    expect(rejected.map(r => `${r.spec.id}: ${r.issues[0]?.problem}`)).toEqual([])
    expect(dupes).toEqual([])
    expect(allParts().length).toBeGreaterThan(0)
  })
})

describe('приёмка паспорта', () => {
  const base = (over: Partial<PartSpec>): PartSpec => ({
    id: 'test-part', article: 'X-1', label: 'Тест', role: 'handle',
    dims: { a: 10 }, geometry: [{ p: 'box', size: [10, 10, 10] }],
    mount: { on: 'glass-face' }, ...over,
  })

  it('ловит метры вместо миллиметров', () => {
    const issues = validatePart(base({ geometry: [{ p: 'box', size: [0.02, 0.02, 0.06] }] }))
    expect(issues.some(i => /миллиметр/.test(i.problem))).toBe(true)
  })

  it('ловит размер не того порядка', () => {
    const issues = validatePart(base({ geometry: [{ p: 'box', size: [20, 20, 6000] }] }))
    expect(issues.some(i => /не размер детали/.test(i.problem))).toBe(true)
  })

  it('требует объявить сечение штанги у детали на штанге', () => {
    const issues = validatePart(base({ mount: { on: 'tube' } }))
    expect(issues.some(i => i.field === 'mount.clamps')).toBe(true)
  })

  it('не даёт обойме быть уже трубы — иначе труба пройдёт насквозь', () => {
    const issues = validatePart(base({
      mount: { on: 'tube', clamps: [30, 10] },
      geometry: [{ p: 'clamp', section: [20, 10], wall: 3, len: 22 }],
    }))
    expect(issues.some(i => /меньше штанги/.test(i.problem))).toBe(true)
  })

  it('не пропускает несчитанный с чертежа размер', () => {
    const issues = validatePart(base({ dims: { reach: null as unknown as number } }))
    expect(issues.some(i => i.field === 'dims.reach')).toBe(true)
  })

  it('сквозной может быть только деталь на плоскости стекла', () => {
    const issues = validatePart(base({ mount: { on: 'glass-edge', through: true } }))
    expect(issues.some(i => i.field === 'mount.through')).toBe(true)
  })
})

describe('посадка', () => {
  const face = surfaces.glassFace([1, 1, 0], [0, -1], [1, 0], 8)

  it('ноль детали лежит на грани стекла, а не в его середине', () => {
    const r = placePart(SD_210_L230, face)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // грань = центр ∓ половина толщины по нормали: 0 − 4 мм
    expect(mm(r.placement.pos[2])).toBe(-4)
    expect(mm(r.placement.pos[1])).toBe(1000)
  })

  it('вторая половина сквозной ручки стоит по ту сторону полотна и развёрнута', () => {
    const r = placePart(SD_210_L230, face)
    if (!r.ok) throw new Error(r.reason)
    const back = r.placement.mirror
    expect(back).toBeTruthy()
    expect(mm(back!.pos[2])).toBe(4)                       // +4 мм: другая грань
    expect(Math.abs(back!.rotY - r.placement.rotY)).toBeCloseTo(Math.PI, 6)
  })

  it('локальная +Z смотрит в нормаль поверхности', () => {
    for (const out of [[0, 1], [0, -1], [1, 0], [-1, 0]] as [number, number][]) {
      const s = surfaces.glassFace([0, 0, 0], out, [out[1], -out[0]], 8)
      const r = placePart(SD_210_L230, s)
      if (!r.ok) throw new Error(r.reason)
      const a = r.placement.rotY
      expect(Math.sin(a)).toBeCloseTo(out[0], 6)
      expect(Math.cos(a)).toBeCloseTo(out[1], 6)
    }
  })

  it('не садит деталь на чужую поверхность', () => {
    const r = placePart(SD_210_L230, surfaces.tube([0, 1, 0], [1, 0], [0, -1], [30, 10]))
    expect(r.ok).toBe(false)
  })

  it('не ставит ручку на стекло вне её диапазона толщин', () => {
    const r = placePart(SD_210_L230, surfaces.glassFace([0, 1, 0], [0, -1], [1, 0], 6))
    expect(r.ok).toBe(false)
  })
})

describe('ручка SD-210 в сборке', () => {
  const model = getModel('М2')
  const asm = buildFromModel(model, { width: 1200, height: 2000, doorWidth: 600 }, 8, true)
  const handles = asm.hardware.filter(h => h.key.includes('handle'))

  it('рисуется двумя половинами — как на чертеже', () => {
    expect(handles.length).toBe(2)
    expect(handles.filter(h => h.mirrorOf).length).toBe(1)
  })

  it('половины разнесены ровно на толщину полотна', () => {
    const [a, b] = handles
    const d = Math.hypot(a.pos[0] - b.pos[0], a.pos[2] - b.pos[2])
    expect(mm(d)).toBe(8)
  })

  it('центр ручки — 950 мм от низа полотна, у свободной кромки', () => {
    expect(mm(handles[0].pos[1])).toBe(950)
    const door = asm.glass.find(g => g.role === 'door')!
    const off = Math.hypot(handles[0].pos[0] - door.pos[0], handles[0].pos[2] - door.pos[2])
    expect(off).toBeGreaterThan(0.1)   // раньше смещение по Z умножалось на ноль
  })

  it('комплект считает одну ручку, а не две', () => {
    const q = computeKitQuantities(asm, 8, model)
    expect(q.roleQty.handle).toBe(1)
  })
})

describe('кноб FDR-30', () => {
  it('заведён и ставится двумя половинами — он сквозной', () => {
    const asm = buildFromModel(getModel('М2'), { width: 1200, height: 2000, doorWidth: 600 }, 8, true, { handle: 'handle-knob' })
    const h = asm.hardware.filter(x => x.key.includes('handle'))
    expect(h.length).toBe(2)
    expect(h[0].part).toBe('handle-knob')
    expect(mm(h[0].pos[1])).toBe(950)
  })
  it('в комплекте считается одной позицией', () => {
    const model = getModel('М2')
    const asm = buildFromModel(model, { width: 1200, height: 2000, doorWidth: 600 }, 8, true, { handle: 'handle-knob' })
    expect(computeKitQuantities(asm, 8, model).roleQty.handle).toBe(1)
  })
})

// Реальные названия позиций из комплекта М7 (справочник Веры, поле «вид» пустое):
// форма берётся из названия, и она обязана быть кнобом, а не скобой по умолчанию.
describe('форма по названию позиции комплекта', () => {
  it('«Ручка кноб FDR-30 квадратная, алюминий/хром» — это кноб', () => {
    expect(inferShape('Ручка кноб FDR-30 квадратная, алюминий/хром')).toBe('handle-knob')
  })
  it('«Петля Европа FDP-115 стекло-стекло 180°» — это петля стекло-стекло', () => {
    expect(inferShape('Петля Европа FDP-115 стекло-стекло 180° без крыш')).toBe('hinge-glass')
  })
  it('скоба остаётся скобой', () => {
    expect(inferShape('Ручка-скоба SD-210/L230')).toBe('handle-bar')
  })
})

describe('деталь без паспорта не ломает сцену', () => {
  it('неизвестная форма рисуется прежним способом', () => {
    expect(getPart('handle-inset')).toBeNull()   // купе ещё на старой форме
    const asm = buildFromModel(getModel('М2'), { width: 1200, height: 2000, doorWidth: 600 }, 8, true, { handle: 'handle-inset' })
    const handles = asm.hardware.filter(h => h.key.includes('handle'))
    expect(handles.length).toBe(1)
    expect(handles[0].part).toBeUndefined()
  })
})

// Правки по замечаниям владельца 03.09: щель в пятиграннике, ролики, раздвижка.
describe('геометрия по замечаниям владельца', () => {
  const dims11 = { width: 1000, height: 2000, width2: 1000, doorWidth: 600 }

  it('М11: дверь занимает диагональ целиком — щели между дверью и стационаром нет', () => {
    const a = buildFromModel(getModel('М11'), dims11, 8, false)
    const door = a.glass.find(g => g.role === 'door')!
    const diag = a.metal.find(m => m.key === 'd-bot')!
    expect(mm(door.size[0])).toBe(mm(diag.size[0]))
  })

  it('М11: срез следует ширине двери, а не половине стороны', () => {
    const wide = buildFromModel(getModel('М11'), { ...dims11, doorWidth: 700 }, 8, false)
    const narrow = buildFromModel(getModel('М11'), { ...dims11, doorWidth: 450 }, 8, false)
    expect(mm(wide.glass.find(g => g.role === 'door')!.size[0])).toBe(700)
    expect(mm(narrow.glass.find(g => g.role === 'door')!.size[0])).toBe(450)
  })

  it('раздвижная: ось ролика в 80 мм от кромки створки', () => {
    const a = buildFromModel(getModel('М10'), { width: 1400, height: 2000, doorWidth: 700 }, 8, false)
    const leaf = a.glass.find(g => g.role === 'door')!
    const rollers = a.hardware.filter(h => h.model === 'roller')
    expect(rollers.length).toBe(2)
    const half = leaf.size[0] / 2
    for (const r of rollers) {
      const along = Math.abs(r.pos[0] - leaf.pos[0])
      expect(mm(half - along)).toBe(80)
    }
  })

  it('раздвижная закрывается и открывается кнопкой', () => {
    const dims = { width: 1400, height: 2000, doorWidth: 700 }
    const closed = buildFromModel(getModel('М10'), dims, 8, false).glass.find(g => g.role === 'door')!
    const open = buildFromModel(getModel('М10'), dims, 8, true).glass.find(g => g.role === 'door')!
    expect(mm(closed.pos[0])).not.toBe(mm(open.pos[0]))
    // закрытая створка примыкает к стационару, открытая наезжает на него
    const fixed = buildFromModel(getModel('М10'), dims, 8, false).glass.find(g => g.role === 'fixed')!
    const gap = mm(closed.pos[0] - closed.size[0] / 2) - mm(fixed.pos[0] + fixed.size[0] / 2)
    expect(Math.abs(gap)).toBeLessThanOrEqual(1)
    expect(mm(open.pos[0])).toBeLessThan(mm(closed.pos[0]))
  })
})
