import { describe, it, expect } from 'vitest'
import { holeBand, holeProblems, holeServices, bandLabel, type HolePrice } from '@/lib/b2b/holePrices'
import { isSurchargeServiceId } from '@/lib/surcharges'

const rows: HolePrice[] = [
  { id: 1, d_max: 12, t_max: 6, sale: 80, cost: 30 }, { id: 2, d_max: 30, t_max: 6, sale: 107, cost: 40 },
  { id: 3, d_max: 45, t_max: 6, sale: 179, cost: 0 }, { id: 4, d_max: 90, t_max: 6, sale: 241, cost: 0 },
  { id: 5, d_max: 12, t_max: 19, sale: 89, cost: 0 }, { id: 6, d_max: 30, t_max: 19, sale: 151, cost: 60 },
  { id: 7, d_max: 45, t_max: 19, sale: 223, cost: 0 }, { id: 8, d_max: 90, t_max: 19, sale: 0, cost: 0 },
]

describe('отверстия по диаметру и толщине', () => {
  it('полосы смежные: Ø13 — в «до 30», 8 мм — в «до 19»', () => {
    expect(holeBand(13, 6, rows)?.id).toBe(2)
    expect(holeBand(12, 8, rows)?.id).toBe(5)
    expect(holeBand(100, 8, rows)).toBeNull()
    expect(holeBand(10, 24, rows)).toBeNull()
    expect(bandLabel(rows[1], rows)).toBe('Ø13–30')
  })
  it('цена × отверстий на деталь, группы одной полосы складываются', () => {
    const s = holeServices([{ d: 20, n: 2 }, { d: 25, n: 1 }, { d: 10, n: 4 }], 8, rows)
    expect(s.map(x => [x.name, x.value, x.cost_price])).toEqual([['Отверстие Ø до 12 × 4', 356, 0], ['Отверстие Ø13–30 × 3', 453, 180]])
    expect(s.every(x => x.id < 0 && !isSurchargeServiceId(x.id))).toBe(true)
  })
  it('без диаметров, без цены и вне справочника — проблема, а не ноль', () => {
    expect(holeProblems(true, [], 8, rows)).toEqual(['Отверстия: укажите диаметр и количество'])
    expect(holeProblems(true, [{ d: 60, n: 1 }], 10, rows)).toEqual(['Отверстие Ø60: не задана цена'])
    expect(holeProblems(true, [{ d: 120, n: 1 }], 10, rows)).toEqual(['Отверстие Ø120 при 10 мм: нет в справочнике'])
    expect(holeProblems(false, [], 8, rows)).toEqual([])
  })
})
