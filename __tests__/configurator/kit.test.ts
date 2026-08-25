import { describe, it, expect } from 'vitest'
import {
  computeKitQuantities, computeKitPrice, kitChoices, planBars, inferRole, resolveQty,
  libraryFromUnitPrices, parseLengthMm,
  type Library, type ModelKit, type KitRates,
} from '@/lib/configurator/kit'
import { buildFromModel } from '@/components/configurator/scene/assembly'
import { getModel } from '@/lib/configurator/arrangement'

const RATES: KitRates = {
  glassPerM2: { clear: 3200, crystal: 3900, bronze: 4600, graphite: 4600 },
  installPerSection: 6500, deliveryMoscow: 5000, liftPerFloor: 0,
}
const FIN = { marginPct: 40, taxPct: 12 }
const m7 = () => buildFromModel(getModel('М7'), { width: 1100, height: 2000, width2: 900, doorWidth: 600 }, 8)

const LIB: Library = { items: [
  { id: 'hinge-balge', name: 'Петля Balge-004', role: 'hinge', prices: { chrome: 2988, gold: 4000 } },
  { id: 'hinge-fdp', name: 'Петля Европа FDP-115', role: 'hinge', prices: { chrome: 1162 } },
  { id: 'handle-knob', name: 'Ручка кноб FDR-30', role: 'handle', prices: { chrome: 292 } },
  { id: 'mount-wall', name: 'FDC-30 труба к стене', role: 'mount-wall', prices: { chrome: 352 } },
  { id: 'mount-glass', name: 'FDC-35 держатель стекла', role: 'mount-glass', prices: { chrome: 622 } },
  { id: 'mount-corner', name: 'FDC-34 труба к стеклу', role: 'mount-corner', prices: { chrome: 570 } },
  { id: 'cap', name: 'Заглушка FDPA-500.1, 1 м', role: 'cap', stocks: [{ len: 1000, prices: { chrome: 158 } }] },
  { id: 'cap-end', name: 'Заглушка торцевая FDPA-501', role: 'cap-end', prices: { chrome: 142 } },
  { id: 'seal-mag', name: 'Уплотнитель магнитный 2.2 м', role: 'seal-magnet', stocks: [{ len: 2200, prices: { chrome: 1028 } }] },
  { id: 'seal-bot', name: 'Уплотнитель нижний 2.2 м', role: 'seal-bottom', stocks: [{ len: 2200, prices: { chrome: 262 } }] },
  { id: 'seal-hin', name: 'Уплотнитель Ч-образный 2.2 м', role: 'seal-hinge', stocks: [{ len: 2200, prices: { chrome: 202 } }] },
  { id: 'profile', name: 'Профиль FDPA-51', role: 'profile', stocks: [{ len: 2200, prices: { chrome: 712 } }, { len: 3000, prices: { chrome: 900 } }] },
  { id: 'tube', name: 'Труба FDT-352 30×10', role: 'tube', stocks: [{ len: 3000, prices: { chrome: 2175 } }] },
] }

const kitM7 = (): ModelKit => ({ slots: [
  { role: 'hinge', select: 'one', entries: [
    { itemId: 'hinge-balge', qty: { mode: 'role' }, primary: true },
    { itemId: 'hinge-fdp', qty: { mode: 'role' } },
  ] },
  { role: 'handle', select: 'one', entries: [{ itemId: 'handle-knob', qty: { mode: 'role' }, primary: true }] },
  { role: 'mount-wall', select: 'all', entries: [{ itemId: 'mount-wall', qty: { mode: 'role' } }] },
  { role: 'mount-glass', select: 'all', entries: [{ itemId: 'mount-glass', qty: { mode: 'role' } }] },
  { role: 'mount-corner', select: 'all', entries: [{ itemId: 'mount-corner', qty: { mode: 'role' } }] },
  { role: 'cap', select: 'all', entries: [{ itemId: 'cap', qty: { mode: 'role' } }] },
  { role: 'cap-end', select: 'all', entries: [{ itemId: 'cap-end', qty: { mode: 'role' } }] },
  { role: 'seal-magnet', select: 'all', entries: [{ itemId: 'seal-mag', qty: { mode: 'role' } }] },
  { role: 'seal-bottom', select: 'all', entries: [{ itemId: 'seal-bot', qty: { mode: 'role' } }] },
  { role: 'seal-hinge', select: 'all', entries: [{ itemId: 'seal-hin', qty: { mode: 'role' } }] },
  { role: 'profile', select: 'one', entries: [{ itemId: 'profile', qty: { mode: 'role' }, primary: true }] },
  { role: 'tube', select: 'one', entries: [{ itemId: 'tube', qty: { mode: 'role' }, primary: true }] },
] })

describe('kit — количества из геометрии', () => {
  it('М7: петли, ручка, три РАЗНЫХ крепежа, заглушки = 2×кусков профиля', () => {
    const q = computeKitQuantities(m7(), 8, getModel('М7'))
    expect(q.roleQty.hinge).toBeGreaterThanOrEqual(2)
    expect(q.roleQty.handle).toBe(1)
    expect(q.roleQty['mount-wall']).toBeGreaterThan(0)
    expect(q.roleQty['mount-glass']).toBeGreaterThan(0)
    expect(q.roleQty['mount-corner']).toBeGreaterThan(0)
    expect(q.roleQty['cap-end']).toBe(q.profilePieces.length * 2)   // торцевые — штуками
    expect(q.barPieces.cap).toEqual([650])                          // погонная — только проём двери 600 + запас
    expect(q.roleQty.roller).toBe(0)          // распашная — роликов нет
  })

  it('М7: три уплотнителя одновременно, погонно — вертикальные по высоте, нижний по ширине', () => {
    const q = computeKitQuantities(m7(), 8, getModel('М7'))
    expect(q.swingDoors).toBe(1)
    expect(q.barPieces['seal-magnet']).toEqual([2000])   // высота двери
    expect(q.barPieces['seal-hinge']).toEqual([2000])
    expect(q.barPieces['seal-bottom']).toEqual([600])    // ширина двери
  })

  it('М10 (раздвижная): ролики есть, петель нет', () => {
    const q = computeKitQuantities(buildFromModel(getModel('М10'), { width: 1400, height: 2000 }, 8), 8, getModel('М10'))
    expect(q.roleQty.roller).toBeGreaterThan(0)
    expect(q.roleQty.hinge).toBe(0)
    expect(q.slideDoors).toBe(1)
  })

  it('петель больше на широкой и высокой двери', () => {
    const narrow = computeKitQuantities(buildFromModel(getModel('М2'), { width: 1200, height: 2000, doorWidth: 600 }, 8), 8, getModel('М2'))
    const wide = computeKitQuantities(buildFromModel(getModel('М2'), { width: 1600, height: 2200, doorWidth: 800 }, 8), 8, getModel('М2'))
    expect(wide.roleQty.hinge).toBeGreaterThan(narrow.roleQty.hinge)
  })
})

describe('kit — раскрой хлыстов', () => {
  const stocks = [{ len: 2200, price: 712 }, { len: 3000, price: 900 }]

  it('два куска влезают в один хлыст — считается ОДИН, а не два', () => {
    const r = planBars([1500, 1200], stocks)
    expect(r.plan.length).toBe(1)
    expect(r.plan[0].len).toBe(3000)
    expect(r.cost).toBe(900)
  })

  it('выбирается дешёвый набор, а не самый длинный хлыст', () => {
    const r = planBars([2000, 2000], stocks)
    expect(r.cost).toBe(712 * 2)
    expect(r.bars).toEqual({ 2200: 2 })
  })

  it('учитывается пропил: 1500+1500+kerf не влезает в 3000', () => {
    expect(planBars([1500, 1500], stocks, 0).plan.length).toBe(1)
    expect(planBars([1500, 1500], stocks, 5).plan.length).toBe(2)
  })

  it('жёсткий профиль: кусок длиннее хлыста — считаем по самому длинному и помечаем негабарит', () => {
    const r = planBars([3500], stocks)
    expect(r.cost).toBe(900)
    expect(r.oversize).toEqual([3500])
  })

  it('погонный материал стыкуется: заглушка 2000 мм из метровых хлыстов = 2 хлыста', () => {
    const meter = [{ len: 1000, price: 158 }]
    const r = planBars([2000], meter, 0, true)
    expect(r.plan.length).toBe(2)
    expect(r.cost).toBe(316)
    expect(r.oversize).toEqual([])
  })

  it('нет цен или нет кусков — ноль', () => {
    expect(planBars([], stocks).cost).toBe(0)
    expect(planBars([2000], [{ len: 2200, price: 0 }]).cost).toBe(0)
  })
})

describe('kit — расчёт по комплекту модели', () => {
  it('комплект М7 полный, формула Себест/(1−маржа−налог) + монтаж×секции + доставка', () => {
    const q = computeKitQuantities(m7(), 8, getModel('М7'))
    const p = computeKitPrice(q, LIB, kitM7(), RATES, FIN, { finishId: 'chrome' })
    expect(p.missing).toEqual([])
    expect(p.complete).toBe(true)
    expect(p.materialsCost).toBe(p.glassCost + p.hardwareCost)
    expect(p.itemPrice).toBe(Math.round(p.materialsCost / 0.48))
    expect(p.installCost).toBe(6500 * q.sections)
    expect(p.total).toBe(p.itemPrice + p.installCost + 5000)
  })

  it('«одна из списка»: считается ★, выбор клиента её замещает и меняет цену', () => {
    const q = computeKitQuantities(m7(), 8, getModel('М7'))
    const def = computeKitPrice(q, LIB, kitM7(), RATES, FIN, { finishId: 'chrome' })
    const alt = computeKitPrice(q, LIB, kitM7(), RATES, FIN, { finishId: 'chrome', choice: { hinge: 'hinge-fdp' } })
    expect(def.lines.filter(l => l.role === 'hinge').length).toBe(1)
    expect(def.lines.find(l => l.role === 'hinge')!.itemId).toBe('hinge-balge')
    expect(alt.lines.find(l => l.role === 'hinge')!.itemId).toBe('hinge-fdp')
    expect(alt.total).toBeLessThan(def.total)
  })

  it('«все сразу»: три крепежа и три уплотнителя дают отдельные строки', () => {
    const q = computeKitQuantities(m7(), 8, getModel('М7'))
    const p = computeKitPrice(q, LIB, kitM7(), RATES, FIN, { finishId: 'chrome' })
    expect(p.lines.filter(l => l.role.startsWith('mount-')).length).toBe(3)
    expect(p.lines.filter(l => l.role.startsWith('seal-')).length).toBe(3)
    expect(p.lines.filter(l => l.role.startsWith('seal-')).every(l => l.unit === 'хлыст')).toBe(true)
  })

  it('удалённая роль, которая модели НЕ нужна (ролики у М7) — не ошибка', () => {
    const q = computeKitQuantities(m7(), 8, getModel('М7'))
    const p = computeKitPrice(q, LIB, kitM7(), RATES, FIN, { finishId: 'chrome' })
    expect(p.missing.some(m => m.role === 'roller')).toBe(false)
  })

  it('негабаритный кусок жёсткого профиля виден в missing, а не молча дешевеет', () => {
    const q = computeKitQuantities(m7(), 8, getModel('М7'))
    const lib: Library = { items: LIB.items.map(i => i.id === 'profile' ? { ...i, stocks: [{ len: 1200, prices: { chrome: 400 } }] } : i) }
    const p = computeKitPrice(q, lib, kitM7(), RATES, FIN, { finishId: 'chrome' })
    expect(p.missing.some(m => m.role === 'profile' && m.reason === 'кусок длиннее хлыста')).toBe(true)
  })

  it('роль модели нужна, а слота нет — попадает в missing (не уедет дешевле себестоимости)', () => {
    const q = computeKitQuantities(m7(), 8, getModel('М7'))
    const kit = kitM7()
    kit.slots = kit.slots.filter(s => s.role !== 'hinge')
    const p = computeKitPrice(q, LIB, kit, RATES, FIN, { finishId: 'chrome' })
    expect(p.complete).toBe(false)
    expect(p.missing.some(m => m.role === 'hinge' && m.reason === 'нет позиции')).toBe(true)
  })

  it('позиция есть, а цены в этом цвете нет — missing «нет цены»', () => {
    const q = computeKitQuantities(m7(), 8, getModel('М7'))
    const p = computeKitPrice(q, LIB, kitM7(), RATES, FIN, { finishId: 'rose' })
    // Balge знает только chrome/gold → фолбэк на chrome, значит цена есть
    expect(p.lines.find(l => l.role === 'hinge')!.unitPrice).toBe(2988)
    const lib: Library = { items: LIB.items.map(i => i.id === 'handle-knob' ? { ...i, prices: {} } : i) }
    const p2 = computeKitPrice(q, lib, kitM7(), RATES, FIN, { finishId: 'chrome' })
    expect(p2.missing.some(m => m.role === 'handle' && m.reason === 'нет цены')).toBe(true)
  })

  it('количество как выбор клиента: 2 или 3 петли — цена меняется', () => {
    const q = computeKitQuantities(m7(), 8, getModel('М7'))
    const kit = kitM7()
    kit.slots[0].entries[0].qty = { mode: 'client', options: [2, 3], def: 2 }
    const two = computeKitPrice(q, LIB, kit, RATES, FIN, { finishId: 'chrome' })
    const three = computeKitPrice(q, LIB, kit, RATES, FIN, { finishId: 'chrome', qtyChoice: { hinge: 3 } })
    expect(two.lines.find(l => l.role === 'hinge')!.qty).toBe(2)
    expect(three.lines.find(l => l.role === 'hinge')!.qty).toBe(3)
    expect(three.total).toBeGreaterThan(two.total)
  })

  it('правило «N × другой роли»: заглушек вдвое больше кусков профиля', () => {
    const q = computeKitQuantities(m7(), 8, getModel('М7'))
    expect(resolveQty({ mode: 'per', of: 'profile', k: 2 }, 'cap', q, {})).toBe(q.profilePieces.length * 2)
    expect(resolveQty({ mode: 'fixed', n: 4 }, 'cap', q, {})).toBe(4)
  })
})

describe('kit — что видит клиент', () => {
  it('варианты только там, где выбор; ★ идёт первой; себестоимости нет', () => {
    const q = computeKitQuantities(m7(), 8, getModel('М7'))
    const kit = kitM7()
    kit.slots[0].entries = [
      { itemId: 'hinge-fdp', qty: { mode: 'role' } },
      { itemId: 'hinge-balge', qty: { mode: 'role' }, primary: true },
    ]
    const ch = kitChoices(LIB, kit, q)
    const hinge = ch.variants.find(v => v.role === 'hinge')!
    expect(hinge.options[0].itemId).toBe('hinge-balge')
    expect(hinge.options[0].primary).toBe(true)
    expect(Object.keys(hinge.options[0])).toEqual(['itemId', 'name', 'shape', 'primary'])
    expect(ch.variants.some(v => v.role === 'handle')).toBe(false)   // один вариант — выбирать нечего
  })

  it('выбор количества уезжает клиенту отдельным списком', () => {
    const q = computeKitQuantities(m7(), 8, getModel('М7'))
    const kit = kitM7()
    kit.slots[0].entries[0].qty = { mode: 'client', options: [2, 3], def: 2 }
    const ch = kitChoices(LIB, kit, q)
    expect(ch.quantities).toEqual([{ role: 'hinge', label: 'Петли', options: [2, 3], def: 2 }])
  })
})

describe('kit — распознавание роли по названию', () => {
  it('название из справочника → роль', () => {
    expect(inferRole('Петля Европа FDP-115 стекло-стекло 180°')).toBe('hinge')
    expect(inferRole('Ручка кноб FDR-30 квадратная')).toBe('handle')
    expect(inferRole('Ручка купе врезная')).toBe('handle-slide')
    expect(inferRole('Держатель стекла FDC-35 сквозной')).toBe('mount-glass')
    expect(inferRole('Крепление FDC-30 трубы 30х10 к стене')).toBe('mount-wall')
    expect(inferRole('Крепление FDC-34 трубы 30х10 к стеклу, нержавейк')).toBe('mount-corner')
    expect(inferRole('Уплотнитель ПРЕМИУМ магнитный 90°')).toBe('seal-magnet')
    expect(inferRole('Уплотнитель ПРЕМИУМ нижний прозрачный')).toBe('seal-bottom')
    expect(inferRole('Заглушка верхняя FDPA-500')).toBe('cap')
    expect(inferRole('Труба FDT-352, 30х10х1')).toBe('tube')
    expect(inferRole('Профиль для стекла FDPA-51')).toBe('profile')
    expect(inferRole('Ролик РД-001')).toBe('roller')
    expect(inferRole('Непонятная железка')).toBe(null)
  })
})

describe('kit — варианты одной модели (М1: труба 90° / 45° / стабилизатор / в потолок)', () => {
  // Геометрия помечает узел через spec — у вариантов разные артикулы, по общему kind их не развести.
  const asm = (spec: string, len: number) => ({
    glass: [{ key: 'g', role: 'fixed' as const, rotY: 0, pos: [0, 1, 0] as [number, number, number], size: [0.9, 2, 0.008] as [number, number, number] }],
    metal: [{ key: 'b', kind: 'rail' as const, rotY: 0, pos: [0, 2, 0] as [number, number, number], size: [len, 0.03, 0.01] as [number, number, number], spec }],
    hardware: [],
    niche: { w: 1, depth: 1, wallH: 2.5, trayH: 0, walls: { back: true, left: false, right: false } },
    bounds: { w: 1, d: 1, h: 2 }, center: [0.5, 1, 0.5] as [number, number, number],
  })

  const lib: Library = { items: [
    { id: 't90', name: 'Труба FDT-35L', role: 'tube', stocks: [{ len: 1000, prices: { chrome: 900 } }] },
    { id: 't45', name: 'Штанга FDT-55L', role: 'tube-diag45', stocks: [{ len: 1400, prices: { chrome: 1600 } }] },
  ] }
  const kit: ModelKit = { slots: [
    { role: 'tube', select: 'one', entries: [{ itemId: 't90', qty: { mode: 'role' }, primary: true }] },
    { role: 'tube-diag45', select: 'one', entries: [{ itemId: 't45', qty: { mode: 'role' }, primary: true }] },
  ] }

  it('активен только выбранный вариант — второй не считается и не идёт в missing', () => {
    const q = computeKitQuantities(asm('tube-perp90', 0.9), 8)
    expect(q.barPieces['tube']).toEqual([900])
    expect(q.roleQty['tube-diag45']).toBe(0)
    const p = computeKitPrice(q, lib, kit, RATES, FIN, { finishId: 'chrome' })
    expect(p.lines.map(l => l.role)).toEqual(['tube'])
    expect(p.missing).toEqual([])
  })

  it('вариант 45° берёт свой артикул и свою цену', () => {
    const q = computeKitQuantities(asm('tube-diag45', 1.27), 8)
    const p = computeKitPrice(q, lib, kit, RATES, FIN, { finishId: 'chrome' })
    expect(p.lines.map(l => l.itemId)).toEqual(['t45'])
    expect(p.hardwareCost).toBe(1600)
  })

  it('без пометки spec работает старый фолбэк: rail → труба, профиль → профиль', () => {
    const q = computeKitQuantities(asm('', 1.1), 8)
    expect(q.barPieces['tube']).toEqual([1100])
    expect(q.tubePieces).toEqual([1100])
  })
})

describe('kit — перенос погонных позиций из старой штучной схемы', () => {
  it('уплотнитель и заглушка становятся хлыстами, длина берётся из названия поставщика', () => {
    const lib = libraryFromUnitPrices({ groups: [
      { id: 'seals', kind: 'piece', items: [
        { key: 's1', name: 'Уплотнитель ПРЕМИУМ магнитный 90°, 180° прозрачн', prices: { chrome: 1028 },
          ref: { supplier: 'av24', base: 'FDPP-502.8', label: 'Уплотнитель ПРЕМИУМ магнитный 90°, 180° прозрачный 2.2 м' } },
      ] },
      { id: 'caps', kind: 'piece', items: [
        { key: 'c1', name: 'Заглушка верхняя FDPA-500', prices: { chrome: 158 },
          ref: { supplier: 'av24', base: 'FDPA-500.1', label: 'Заглушка верхняя FDPA-500.1, 19х13х2мм, 1 м, для п-образного' } },
      ] },
    ] } as never)
    const seal = lib.items.find(i => i.id === 's1')!
    expect(seal.role).toBe('seal-magnet')
    expect(seal.stocks).toEqual([{ len: 2200, prices: { chrome: 1028 } }])
    const cap = lib.items.find(i => i.id === 'c1')!
    expect(cap.role).toBe('cap')
    expect(cap.stocks).toEqual([{ len: 1000, prices: { chrome: 158 } }])
  })

  it('длина из названия: «2.2 м», «1 м», «3 м»; «30х10х1.5 мм» длиной не считается', () => {
    expect(parseLengthMm('Уплотнитель прозрачный 2.2 м, ус 18 мм')).toBe(2200)
    expect(parseLengthMm('Заглушка верхняя FDPA-500.1, 19х13х2мм, 1 м')).toBe(1000)
    expect(parseLengthMm('Профиль FDPA-51.3, длина 3 м')).toBe(3000)
    expect(parseLengthMm('Крепление трубы 30х10 к стене')).toBe(0)
  })

  it('торцевая заглушка распознаётся отдельно от погонной', () => {
    expect(inferRole('Заглушка торцевая FDPA-501 для п-образного профиля')).toBe('cap-end')
    expect(inferRole('Заглушка верхняя FDPA-500.1, 1 м')).toBe('cap')
  })
})

describe('kit — заглушка ставится только в проёме двери', () => {
  it('стационар закрывает полость профиля стеклом — заглушки под ним нет', () => {
    const q = computeKitQuantities(m7(), 8, getModel('М7'))
    expect(q.profilePieces).toEqual([900, 1100, 2000, 2000])   // профиля много
    expect(q.barPieces.cap).toEqual([650])                     // а заглушка одна — по двери
    expect(q.doorWidths).toEqual([600])
  })

  it('модель без двери (М1 стационарная) — погонной заглушки нет вовсе', () => {
    const q = computeKitQuantities(buildFromModel(getModel('М1'), { width: 900, height: 2000 }, 8), 8, getModel('М1'))
    expect(q.doorWidths).toEqual([])
    expect(q.barPieces.cap).toBeUndefined()
    expect(q.roleQty.cap).toBe(0)
  })

  it('запас по ширине двери настраивается', () => {
    expect(computeKitQuantities(m7(), 8, getModel('М7'), 0).barPieces.cap).toEqual([600])
    expect(computeKitQuantities(m7(), 8, getModel('М7'), 120).barPieces.cap).toEqual([720])
  })

  it('заглушка по двери дешевле, чем по всей длине профиля', () => {
    const q = computeKitQuantities(m7(), 8, getModel('М7'))
    const lib: Library = { items: [{ id: 'cp', name: 'Заглушка 1 м', role: 'cap', stocks: [{ len: 1000, prices: { chrome: 158 } }] }] }
    const kit: ModelKit = { slots: [{ role: 'cap', select: 'one', entries: [{ itemId: 'cp', qty: { mode: 'role' }, primary: true }] }] }
    const p = computeKitPrice(q, lib, kit, RATES, FIN, { finishId: 'chrome' })
    expect(p.lines.find(l => l.role === 'cap')!.total).toBe(158)   // один метровый хлыст вместо четырёх кусков
  })
})
