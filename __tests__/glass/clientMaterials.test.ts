import { describe, it, expect } from 'vitest'
import { defaultAt, defaultPick, isPatterned } from '@/lib/glass/clientMaterials'

const m = (id: number, name: string, category: string, thickness: number) => ({ id, name, category, thickness })
// Состав справочника на 24.11.2026 (часть)
const mats = [
  m(12, 'CrystalVision Matelux', 'стекло', 4), m(77, 'ESTRIADO CH', 'стекло', 4), m(81, 'KATHEDRAL MAX CL', 'стекло', 4),
  m(74, 'Flutelite - S 4мм (осветленное)', 'стекло', 4), m(75, 'ИЕРОГЛИФЫ ВОЛНОЙ 4мм', 'стекло', 4),
  m(82, 'Lumilac ® (ЛЮМИЛАК) 4 мм', 'стекло', 4), m(51, 'Осветлённое CrystalVision', 'стекло', 4), m(1, 'Прозрачное М1', 'стекло', 4),
  m(53, 'Осветлённое CrystalVision', 'стекло', 8), m(4, 'Прозрачное М1', 'стекло', 8),
  m(80, 'MORU GRAFIT НАПЫЛЕНИЕ', 'рифленое', 4), m(63, 'Аквалайт (кафедрал) 2440х1830', 'рифленое', 4),
  m(72, 'МОРУ БРОНЗА тонированное в массе', 'тонированное', 8), m(19, 'Тонированное (бронза/графит)', 'тонированное', 8),
]
const mirrors = [
  m(65, 'Antique Mirror A-1', 'зеркало', 4), m(49, 'Осветлённое', 'зеркало', 4), m(60, 'Серебро', 'зеркало', 4),
  m(50, 'Осветлённое', 'зеркало', 6), m(61, 'Серебро', 'зеркало', 6),
]

describe('clientMaterials', () => {
  it('рифлёные распознаются и по категории, и по названию', () => {
    const hidden = mats.filter(isPatterned).map(x => x.id).sort((a, b) => a - b)
    expect(hidden).toEqual([63, 72, 74, 75, 77, 80, 81])
  })
  it('в любой толщине по умолчанию — Прозрачное М1, у зеркала — Серебро', () => {
    expect(defaultAt(mats, 'стекло', 4)?.id).toBe(1)
    expect(defaultAt(mats, 'стекло', 8)?.id).toBe(4)
    expect(defaultAt(mirrors, 'зеркало', 6)?.id).toBe(61)
  })
  it('стартовая толщина без М1 уходит на толщину, где М1 есть', () => {
    expect(defaultPick(mats, 'стекло', 5)?.id).toBe(1)
    expect(defaultPick(mats, 'стекло', 8)?.id).toBe(4)
    expect(defaultPick(mirrors, 'зеркало', 4)?.id).toBe(60)
  })
})
