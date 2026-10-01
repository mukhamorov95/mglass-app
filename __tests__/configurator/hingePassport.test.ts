import { describe, it, expect } from 'vitest'
import { getPart, partForItem } from '@/lib/configurator/parts/registry'
import { buildFromModel } from '@/components/configurator/scene/assembly'
import { getModel } from '@/lib/configurator/arrangement'
import { computeKitQuantities, kitChoices, autoShapeForRole, type Library, type ModelKit } from '@/lib/configurator/kit'
import { hingesBySize, hingesByPassport, doorKg } from '@/lib/configurator/hinges'

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

describe('Число петель: габарит сейчас, паспорт — по решению 2', () => {
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
