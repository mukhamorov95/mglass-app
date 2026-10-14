import { describe, it, expect } from 'vitest'
import { materialsFor, pickMaterial, pickThickness, thicknessesFor } from '@/app/glasmen-demo/_components/groupMaterials'
import type { DemoMaterial } from '@/app/glasmen-demo/_components/api'

let id = 0
const m = (name: string, category: string, thickness: number, pricePerM2: number): DemoMaterial =>
  ({ id: ++id, name, category, thickness, pricePerM2, temperable: category === 'зеркало' ? false : true })

const LIST = [
  m('ИЕРОГЛИФЫ ВОЛНОЙ 4мм', 'стекло', 4, 8000),
  m('Прозрачное М1', 'стекло', 4, 1800),
  m('Осветлённое CrystalVision', 'стекло', 4, 2600),
  m('Прозрачное М1', 'стекло', 8, 3100),
  m('Сатин', 'сатин', 8, 4200),
  m('Прозрачное М1', 'стекло', 10, 3600),
  m('Осветлённое', 'зеркало', 4, 3970),
  m('Серебро', 'зеркало', 4, 1950),
  m('Серебро', 'зеркало', 6, 3250),
]

describe('шаги материала: вид → толщина → материал', () => {
  it('толщины вида с ценой «от»', () => {
    expect(thicknessesFor(LIST, 'glass')).toEqual([{ t: 4, from: 1800, count: 3 }, { t: 8, from: 3100, count: 2 }, { t: 10, from: 3600, count: 1 }])
    expect(thicknessesFor(LIST, 'mirror').map(x => x.t)).toEqual([4, 6])
  })

  it('толщина по умолчанию: прежняя → ходовая (стекло 8, зеркало 4) → ближайшая', () => {
    expect(pickThickness(LIST, 'glass', null)).toBe(8)
    expect(pickThickness(LIST, 'glass', 10)).toBe(10)
    expect(pickThickness(LIST, 'mirror', 8)).toBe(4)
    expect(pickThickness(LIST, 'mirror', 6)).toBe(6)
    expect(pickThickness([], 'glass', 8)).toBeNull()
  })

  it('материал по умолчанию — прозрачное / серебро, а не первый по алфавиту', () => {
    expect(pickMaterial(LIST, 'glass', 4, null)?.name).toBe('Прозрачное М1')
    expect(pickMaterial(LIST, 'mirror', 4, null)?.name).toBe('Серебро')
  })

  it('смена толщины держит материал по имени, если он есть', () => {
    expect(pickMaterial(LIST, 'glass', 4, 'Осветлённое CrystalVision')?.name).toBe('Осветлённое CrystalVision')
    expect(pickMaterial(LIST, 'glass', 8, 'Сатин')?.name).toBe('Сатин')
    expect(pickMaterial(LIST, 'glass', 10, 'Сатин')?.name).toBe('Прозрачное М1')
  })

  it('материалы толщины по категориям, внутри — от дешёвого', () => {
    expect(materialsFor(LIST, 'glass', 4)).toEqual([{ category: 'стекло', items: [LIST[1], LIST[2], LIST[0]] }])
    expect(materialsFor(LIST, 'glass', 8).map(g => g.category)).toEqual(['стекло', 'сатин'])
  })
})
