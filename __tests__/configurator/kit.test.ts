import { describe, it, expect } from 'vitest'
import {
  computeKitQuantities, computeKitPrice, kitChoices, planBars, inferRole, resolveQty,
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
  { id: 'cap', name: 'Заглушка FDPA-500', role: 'cap', prices: { chrome: 158 } },
  { id: 'seal-mag', name: 'Уплотнитель магнитный', role: 'seal-magnet', prices: { chrome: 1028 } },
  { id: 'seal-bot', name: 'Уплотнитель нижний', role: 'seal-bottom', prices: { chrome: 262 } },
  { id: 'seal-hin', name: 'Уплотнитель Ч-образный', role: 'seal-hinge', prices: { chrome: 202 } },
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
    expect(q.roleQty.cap).toBe(q.profilePieces.length * 2)
    expect(q.roleQty.roller).toBe(0)          // распашная — роликов нет
  })

  it('М7: три уплотнителя работают одновременно (магнит, низ, петлевой стык)', () => {
    const q = computeKitQuantities(m7(), 8, getModel('М7'))
    expect(q.swingDoors).toBe(1)
    expect(q.roleQty['seal-magnet']).toBe(1)
    expect(q.roleQty['seal-hinge']).toBe(1)
    expect(q.roleQty['seal-bottom']).toBe(1)
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

  it('кусок длиннее любого хлыста — считаем по самому длинному, деньги не теряем', () => {
    const r = planBars([3500], stocks)
    expect(r.cost).toBe(900)
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
  })

  it('удалённая роль, которая модели НЕ нужна (ролики у М7) — не ошибка', () => {
    const q = computeKitQuantities(m7(), 8, getModel('М7'))
    const p = computeKitPrice(q, LIB, kitM7(), RATES, FIN, { finishId: 'chrome' })
    expect(p.missing.some(m => m.role === 'roller')).toBe(false)
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
    expect(inferRole('Уплотнитель ПРЕМИУМ магнитный 90°')).toBe('seal-magnet')
    expect(inferRole('Уплотнитель ПРЕМИУМ нижний прозрачный')).toBe('seal-bottom')
    expect(inferRole('Заглушка верхняя FDPA-500')).toBe('cap')
    expect(inferRole('Труба FDT-352, 30х10х1')).toBe('tube')
    expect(inferRole('Профиль для стекла FDPA-51')).toBe('profile')
    expect(inferRole('Ролик РД-001')).toBe('roller')
    expect(inferRole('Непонятная железка')).toBe(null)
  })
})
