import { describe, it, expect } from 'vitest'
import { splitPlan } from '@/lib/inventory/reserve'
import type { PlanRow, Unit } from '@/lib/inventory/types'

const avail = (rows: [number, string, Unit, number][]) =>
  new Map(rows.map(([id, name, unit, a]) => [id, { name, unit, available: a }]))

describe('reserveForOrder — раскладка резерв / нехватка', () => {
  it('хватает склада — вся потребность в резерв, нехватки нет', () => {
    const rows: PlanRow[] = [{ item_id: 1, name: 'Сатин 8', unit: 'м2', qty: 3.64, available: 10, matched: 'ref', source: 'Сатин' }]
    const { reserved, shortages } = splitPlan(rows, avail([[1, 'Сатин 8', 'м2', 6.35]]))
    expect(reserved).toHaveLength(1)
    expect(reserved[0].reserved).toBe(3.64)
    expect(shortages).toHaveLength(0)
  })

  it('не хватает — резервируем всю потребность, нехватку в shortage (что купить)', () => {
    const rows: PlanRow[] = [{ item_id: 1, name: 'Сатин 8', unit: 'м2', qty: 10, available: 4, matched: 'ref', source: 'Сатин' }]
    const { reserved, shortages } = splitPlan(rows, avail([[1, 'Сатин 8', 'м2', 4]]))
    expect(reserved[0].reserved).toBe(10)
    expect(shortages).toHaveLength(1)
    expect(shortages[0].reason).toBe('insufficient')
    expect(shortages[0].short).toBe(6)
  })

  it('позиции нет в номенклатуре — это shortage, а не ошибка', () => {
    const rows: PlanRow[] = [{ item_id: null, name: 'Бронза 6', unit: 'м2', qty: 2, available: 0, matched: 'none', source: 'Бронза' }]
    const { reserved, shortages } = splitPlan(rows, avail([]))
    expect(reserved).toHaveLength(0)
    expect(shortages[0].reason).toBe('not_in_stock')
    expect(shortages[0].item_id).toBeNull()
    expect(shortages[0].short).toBe(2)
  })

  it('уже занятый резерв (qty_reserved) вычтен из доступного до раскладки', () => {
    // доступное 6.36 при остатке 10 и резерве 3.64 — приходит извне через availableById
    const rows: PlanRow[] = [{ item_id: 1, name: 'Сатин 8', unit: 'м2', qty: 8, available: 10, matched: 'ref', source: 'Сатин' }]
    const { reserved, shortages } = splitPlan(rows, avail([[1, 'Сатин 8', 'м2', 6.36]]))
    expect(reserved[0].available).toBe(6.36)
    expect(shortages[0].short).toBe(1.64)
  })
})
