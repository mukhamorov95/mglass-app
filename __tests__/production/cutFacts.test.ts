import { describe, it, expect } from 'vitest'
import { orderCutFacts, type CutRow, type CutRemnant } from '@/lib/production/cutFacts'

const cut = (id: number, orders: number[], w = 3210, h = 2250, source = 'sheet'): CutRow => ({
  id, material_name: 'Осветлённое CrystalVision', thickness: 8, source,
  sheet_w: w, sheet_h: h, order_ids: orders, created_by_name: 'Бека', created_at: '2026-09-16T10:00:00Z',
})
const rem = (from: number, code: string, w: number, h: number, status = 'in_stock'): CutRemnant =>
  ({ from_cut_id: from, code, width_mm: w, height_mm: h, status })

describe('факт расхода по заказу — журнал резчика', () => {
  it('один лист под один заказ: отход = лист − детали − остаток', () => {
    const f = orderCutFacts([cut(1, [5479])], [rem(1, 'ОС-1', 2000, 2250)], 5479, 0.8)
    expect(f.sheetM2).toBe(7.22)
    expect(f.remnantM2).toBe(4.5)
    expect(f.wasteM2).toBe(1.92)
    expect(f.rows[0].remnantCodes).toEqual(['ОС-1'])
    expect(f.rows[0].wasteM2).toBe(1.92)
  })

  it('лист общий с другим заказом — отход не делим', () => {
    const f = orderCutFacts([cut(1, [5479, 5480])], [rem(1, 'ОС-1', 1000, 2000)], 5479, 0.8)
    expect(f.wasteM2).toBeNull()
    expect(f.rows[0].sharedWith).toEqual([5480])
    expect(f.rows[0].wasteM2).toBeNull()
  })

  it('резали из остатка со стеллажа — это видно', () => {
    const f = orderCutFacts([cut(1, [5479], 1200, 2000, 'remnant')], [], 5479, 0.8)
    expect(f.rows[0].fromRemnant).toBe(true)
    expect(f.sheetM2).toBe(2.4)
  })

  it('списанный в лом кусок в кодах не показываем, но в площади остатка он есть', () => {
    const f = orderCutFacts([cut(1, [5479])], [rem(1, 'ОС-1', 1000, 2000, 'scrapped')], 5479, 0.8)
    expect(f.rows[0].remnantCodes).toEqual([])
    expect(f.remnantM2).toBe(2)
  })

  it('журнал пуст — фактa нет', () => {
    const f = orderCutFacts([], [], 5479, 0.8)
    expect(f.rows).toHaveLength(0)
    expect(f.wasteM2).toBeNull()
  })
})
