import { describe, it, expect } from 'vitest'
import { getPart, partForItem } from '@/lib/configurator/parts/registry'
import { buildFromModel } from '@/components/configurator/scene/assembly'
import { getModel } from '@/lib/configurator/arrangement'
import { computeKitQuantities, computeKitPrice, kitChoices, autoShapeForRole, type Library, type ModelKit, type KitRates } from '@/lib/configurator/kit'
import { hingesBySize, hingesByPassport, hingeCount, doorKg } from '@/lib/configurator/hinges'

// Ш4: 3D рисует выбранный артикул, а не общую форму роли. Паспорт FDP-232 — с чертежа.
describe('Паспорт FDP-232 и выбор по артикулу', () => {
  it('паспорт принят реестром и находится по названию позиции прайса', () => {
    expect(getPart('hinge-fdp-232')?.article).toBe('FDP-232')
    expect(partForItem('Петля Афродита FDP-232 стекло-стекло 180° с крышками', 'hinge')?.id).toBe('hinge-fdp-232')
    expect(partForItem('Петля FDP-2320 условная', 'hinge')).toBeNull()        // целым словом
    expect(partForItem('Петля Афродита FDP-232', 'handle')).toBeNull()         // роль тоже
    expect(autoShapeForRole('Петля Европа FDP-115 стекло-стекло 180°', 'hinge')).toBe('hinge-glass')
  })

  it('клиент выбирает петлю — варианты слота несут форму паспорта', () => {
    const lib: Library = { items: [
      { id: 'a', name: 'Петля Европа FDP-115 стекло-стекло 180°', role: 'hinge', prices: { chrome: 1000 } },
      { id: 'b', name: 'Петля Афродита FDP-232 стекло-стекло 180°', role: 'hinge', prices: { chrome: 3000 } },
    ] }
    const kit: ModelKit = { slots: [{ role: 'hinge', select: 'one', entries: [{ itemId: 'a', qty: { mode: 'role' }, primary: true }, { itemId: 'b', qty: { mode: 'role' } }] }] }
    const m = getModel('М4')
    const q = computeKitQuantities(buildFromModel(m, { width: 1450, height: 2200, doorWidth: 650 }, 8), 8, m)
    const shapes = kitChoices(lib, kit, q).variants[0].options.map(o => o.shape)
    expect(shapes).toEqual(['hinge-glass', 'hinge-fdp-232'])
  })

  it('в сцене петли с паспортом садятся на кромку двери; число петель и цена прежние', () => {
    const m = getModel('М4')
    const dims = { width: 1450, height: 2200, doorWidth: 650 }
    const plain = buildFromModel(m, dims, 8)
    const withPart = buildFromModel(m, dims, 8, true, { hinge: 'hinge-fdp-232' })
    const hinges = (a: typeof plain) => a.hardware.filter(h => /-h\d+$/.test(h.key))
    expect(hinges(withPart).length).toBe(hinges(plain).length)
    expect(hinges(withPart).every(h => h.part === 'hinge-fdp-232')).toBe(true)
    // ноль паспорта — на петлевой кромке: та же точка, что у рисованной петли
    hinges(withPart).forEach((h, i) => {
      expect(h.pos[0]).toBeCloseTo(hinges(plain)[i].pos[0], 6)
      expect(h.pos[2]).toBeCloseTo(hinges(plain)[i].pos[2], 6)
    })
    expect(computeKitQuantities(withPart, 8, m).roleQty.hinge).toBe(computeKitQuantities(plain, 8, m).roleQty.hinge)
  })
})

// Владелец 10.10: петли в 3D — по чертежам Ветро, начиная с ходовых стекло-стекло.
describe('Паспорта Ветро: Dessau-103 и Balge-004', () => {
  // Габарит по коробкам паспорта, мм: [min, max] по каждой оси рамки.
  const extent = (id: string) => {
    const boxes = getPart(id)!.geometry.filter(g => g.p === 'box') as { size: number[]; at?: number[] }[]
    return [0, 1, 2].map(k => [Math.min(...boxes.map(b => (b.at?.[k] ?? 0) - b.size[k] / 2)), Math.max(...boxes.map(b => (b.at?.[k] ?? 0) + b.size[k] / 2))])
  }

  it('приняты реестром и находятся по названиям прайса Ветро во всех цветах; соседние артикулы — нет', () => {
    expect(getPart('hinge-dessau-103')?.article).toBe('Dessau-103')
    expect(getPart('hinge-balge-004')?.article).toBe('Balge-004')
    expect(partForItem('Dessau-103/CP. Петля стекло-стекло 180°', 'hinge')?.id).toBe('hinge-dessau-103')
    expect(partForItem('Dessau-103/Black/Sa. Петля стекло-стекло 180°', 'hinge')?.id).toBe('hinge-dessau-103')
    expect(partForItem('Dessau-103 Петля хром', 'hinge')?.id).toBe('hinge-dessau-103')        // так петля названа в SolidWorks (0828-2)
    expect(partForItem('Balge-004/BrushedRose/Sa. Петля стекло-стекло 135°-180°', 'hinge')?.id).toBe('hinge-balge-004')
    expect(partForItem('Dessau-102/CP. Петля стекло-стекло 90°', 'hinge')).toBeNull()
    expect(partForItem('Dessau-135/Black. Петля стекло-стекло 135°', 'hinge')).toBeNull()
    expect(partForItem('Balge-002/CP. Петля стена-стекло 90°', 'hinge')).toBeNull()
  })

  it('Dessau-103 — габарит чертежа 117 × 60: 70 до оси на двери, 47 на неподвижном, ось посередине зазора 8', () => {
    const [x, y, z] = extent('hinge-dessau-103')
    expect(z[1] - z[0]).toBeCloseTo(117, 6)
    expect(y[1] - y[0]).toBeCloseTo(60, 6)
    expect(z[0]).toBeCloseTo(4 - 70, 6)            // дверь — в −Z от петлевой кромки
    expect(z[1]).toBeCloseTo(4 + 47, 6)
    expect(x[1] - x[0]).toBeCloseTo(8 + 2 * 6, 6)  // стекло 8 и две крышки по 6
    expect(getPart('hinge-dessau-103')!.load).toBeUndefined()   // нагрузки на карточке нет — не выдумываем
  })

  it('Balge-004 — габарит чертежа 100 × 70, корпус с одной стороны (13), накладки с другой (6,75); кромка двери — 54 от торца', () => {
    const [x, y, z] = extent('hinge-balge-004')
    expect(z[1] - z[0]).toBeCloseTo(100, 6)
    expect(y[1] - y[0]).toBeCloseTo(70, 6)
    expect(z[1]).toBeCloseTo(54, 6)
    expect(z[0]).toBeCloseTo(54 - 100, 6)
    expect(x[1]).toBeCloseTo(4 + 13, 6)
    expect(x[0]).toBeCloseTo(-(4 + 6.75), 6)
    expect(getPart('hinge-balge-004')!.load).toBeUndefined()
  })

  it('без нагрузки в паспорте число петель — по габариту двери, как без паспорта', () => {
    expect(hingeCount(0.65, 2.31, 8, getPart('hinge-dessau-103')!.load?.kgPer2)).toBe(hingesBySize(0.65, 2.31))
  })
})

describe('Число петель: паспорт, без него — габарит (решение 2, 02.10)', () => {
  it('габаритное правило — то же, что было в assembly.ts', () => {
    expect(hingesBySize(0.65, 2.2)).toBe(2)
    expect(hingesBySize(0.65, 2.31)).toBe(3)
    expect(hingesBySize(0.75, 2.0)).toBe(3)
  })

  it('0245 на 2310: дверь ~30 кг, FDP-232 держит 35 кг на две — хватает двух', () => {
    const kg = getPart('hinge-fdp-232')!.load!.kgPer2
    expect(kg).toBe(35)
    expect(doorKg(0.65, 2.31, 8)).toBe(30)
    expect(hingesByPassport(0.65, 2.31, 8, kg)).toEqual({ n: 2, kg: 30, overPassport: false })
  })

  it('дверь 700 × 2200 × 10 (38,5 кг) тяжелее паспорта — три и предупреждение', () => {
    expect(hingesByPassport(0.7, 2.2, 10, 35)).toEqual({ n: 3, kg: 38.5, overPassport: true })
  })
})

describe('Петли по паспорту в 3D и в цене (решение 2, 02.10)', () => {
  const m = getModel('М4')
  const dims2310 = { width: 1450, height: 2310, doorWidth: 650 }
  const hingePts = (a: ReturnType<typeof buildFromModel>) => a.hardware.filter(h => /-h\d+$/.test(h.key)).length
  const RATES: KitRates = { glassPerM2: { clear: 0 }, installPerSection: 0, deliveryMoscow: 0, liftPerFloor: 0 }
  const FIN = { marginPct: 40, taxPct: 12 }
  const lib: Library = { items: [
    { id: 'fdp115', name: 'Петля Европа FDP-115 стекло-стекло 180°', role: 'hinge', prices: { chrome: 1000 } },
    { id: 'fdp232', name: 'Петля Афродита FDP-232 стекло-стекло 180°', role: 'hinge', prices: { chrome: 3000 } },
  ] }
  const kitOf = (itemId: string, qty: ModelKit['slots'][number]['entries'][number]['qty'] = { mode: 'role' }): ModelKit =>
    ({ slots: [{ role: 'hinge', select: 'one', entries: [{ itemId, qty, primary: true }] }] })
  const hingeLine = (kit: ModelKit, opts = {}) => {
    const q = computeKitQuantities(buildFromModel(m, dims2310, 8), 8, m)
    return computeKitPrice(q, lib, kit, RATES, FIN, { withDelivery: false, ...opts }).lines.find(l => l.role === 'hinge')!
  }

  it('hingeCount: паспорт — по весу, без паспорта — габарит', () => {
    expect(hingeCount(0.65, 2.31, 8, 35)).toBe(2)
    expect(hingeCount(0.7, 2.2, 10, 35)).toBe(3)
    expect(hingeCount(0.65, 2.31, 8)).toBe(3)
    expect(hingeCount(0.65, 2.31, 8, null)).toBe(3)
  })

  it('3D: М4 на 2310 с FDP-232 — две петли, без паспорта — три', () => {
    expect(hingePts(buildFromModel(m, dims2310, 8, true, { hinge: 'hinge-fdp-232' }))).toBe(2)
    expect(hingePts(buildFromModel(m, dims2310, 8))).toBe(3)
  })

  it('цена: петля с паспортом — 2 шт на 2310, без паспорта — 3 (как в сцене без выбора)', () => {
    expect(hingeLine(kitOf('fdp232')).qty).toBe(2)
    expect(hingeLine(kitOf('fdp115')).qty).toBe(3)
  })

  it('явный выбор количества менеджером главнее паспорта', () => {
    const client = kitOf('fdp232', { mode: 'client', options: [2, 3], def: 2 })
    expect(hingeLine(client, { qtyChoice: { hinge: 3 } }).qty).toBe(3)
  })

  it('ручка двери не считается петлёй при поиске дверей на петлях', () => {
    const q = computeKitQuantities(buildFromModel(m, dims2310, 8), 8, m)
    expect(q.hingeDoors).toEqual([{ w: expect.any(Number), h: 2310 }])
  })
})
