import { describe, it, expect } from 'vitest'
import { attachReserved } from '@/lib/inventory/db'
import type { PlanRow } from '@/lib/inventory/types'

const row = (item_id: number | null, qty: number): PlanRow => ({
  item_id, name: 'x', unit: 'м2', qty, available: 0, matched: item_id ? 'ref' : 'none', source: 'x',
})

describe('списание по факту — резерв как дефолт количества', () => {
  it('проставляет reserved на позиции, где есть активный резерв', () => {
    const rows = attachReserved([row(1, 3.6), row(2, 5)], new Map([[1, 3.6]]))
    expect(rows[0].reserved).toBe(3.6)
    expect(rows[1].reserved).toBeUndefined()
  })

  it('позиции без карточки (item_id=null) резерв не трогает', () => {
    const rows = attachReserved([row(null, 2)], new Map([[1, 10]]))
    expect(rows[0].reserved).toBeUndefined()
    expect(rows[0].item_id).toBeNull()
  })

  it('частичный расход: reserved показывает полную бронь, факт задаёт рабочий', () => {
    // reserved=10 — дефолт в UI; рабочий впишет 3, остаток вернётся при закрытии резерва
    const rows = attachReserved([row(1, 10)], new Map([[1, 10]]))
    expect(rows[0].reserved).toBe(10)
  })
})
