import { describe, it, expect } from 'vitest'
import { batchTotals, materialSummary, receiveProblem, rowOutstanding, temperFree, temperLines, temperRequestProblem, temperSnapshot, temperTaken } from '@/lib/production/tempering'

const rates = { temperingPerM2: { 8: 500 }, transportPerPiece: 77 }

describe('закалка: расчёт', () => {
  it('едет только закалённое стекло: зеркало и стекло без закалки не попадают', () => {
    const lines = temperLines({
      total_after_discount: 1000, total_sale_inc_vat: 1000, discount_percent: 0,
      items: [
        { localId: 'a', materialName: 'Осветлённое CrystalVision', thickness: 8, width: 600, height: 1000, quantity: 2, hasTempering: true, saleIncVat: 700 },
        { localId: 'b', materialName: 'Серебро', category: 'зеркало', thickness: 4, width: 600, height: 1000, quantity: 1, hasTempering: true, saleIncVat: 200 },
        { localId: 'c', materialName: 'Прозрачное М1', thickness: 8, width: 600, height: 1000, quantity: 1, saleIncVat: 100 },
      ] as never,
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ key: 'a', layer: 1, index: 0, material: 'Осветлённое CrystalVision', thickness: 8, width: 600, height: 1000, qty: 2, area: 1.2 })
  })

  it('триплекс: каждое стекло пакета своей строкой со своим материалом и толщиной', () => {
    const lines = temperLines({
      total_after_discount: 1000, total_sale_inc_vat: 1000, discount_percent: 0,
      items: [{ localId: 't', materialName: 'Прозрачное М1', thickness: 8, width: 1000, height: 1000, quantity: 1, hasTempering: true, hasTriplex: true, triplexGlasses: [{ materialName: 'Осветлённое', thickness: 6 }], saleIncVat: 1000 }] as never,
    })
    expect(lines.map(l => [l.layer, l.material, l.thickness])).toEqual([[1, 'Прозрачное М1', 8], [2, 'Осветлённое', 6]])
    expect(lines[0].amount + lines[1].amount).toBe(1000)
  })

  it('снимок: стоимость по ставке толщины, нет ставки — не ноль, а неизвестно; доли сходятся с целым', () => {
    const line = { key: 'a', layer: 1, index: 0, material: 'М1', thickness: 8, width: 600, height: 1000, qty: 3, area: 1.8, weight: 36, amount: 1000 }
    expect(temperSnapshot(line, 2, rates)).toMatchObject({ area_m2: 1.2, rate_per_m2: 500, cost: 600, transport: 154 })
    expect(temperSnapshot({ ...line, thickness: 15 }, 1, rates)).toMatchObject({ rate_per_m2: null, cost: null })
    const parts = [temperSnapshot(line, 1, rates, 0).amount, temperSnapshot(line, 1, rates, 1).amount, temperSnapshot(line, 1, rates, 2).amount]
    expect(Math.round(parts.reduce((s, n) => s + n, 0) * 100) / 100).toBe(1000)
  })

  it('свободно: черновик и уехавшее заняты, вернувшееся занято, разбитое снова свободно', () => {
    const rows = [
      { batch_id: 1, order_id: 7, line_key: 'a', layer: 1, qty: 3, returned_qty: 1, broken_qty: 1 },
      { batch_id: 2, order_id: 7, line_key: 'a', layer: 1, qty: 1, returned_qty: 0, broken_qty: 0 },
    ]
    const t = temperTaken(rows, id => (id === 1 ? 'sent' : 'draft')).get('7:a:1')
    expect(t).toEqual({ drafted: 1, away: 1, returned: 1, broken: 1 })
    expect(temperFree(5, t)).toBe(2)
    expect(temperRequestProblem({ order_id: 7, line_key: 'a', layer: 1, qty: 3 }, { qty: 5, material: 'М1' }, t)).toContain('можно отправить 2 из 5')
    expect(temperRequestProblem({ order_id: 7, line_key: 'a', layer: 1, qty: 2 }, { qty: 5, material: 'М1' }, t)).toBeNull()
  })

  it('приёмка: больше, чем на закалке, не принять', () => {
    const row = { qty: 3, returned_qty: 1, broken_qty: 0, material: 'М1' }
    expect(rowOutstanding(row)).toBe(2)
    expect(receiveProblem(2, 0, row)).toBeNull()
    expect(receiveProblem(2, 1, row)).toContain('осталось 2')
    expect(receiveProblem(0.5, 0, row)).toContain('целым')
  })

  it('итог и сводка по материалам: нет ставки считается отдельно, материалы разделены по толщине', () => {
    const base = { order_id: 1, weight_kg: 10, transport: 77, amount: 100, returned_qty: 0, broken_qty: 0 }
    expect(batchTotals([{ ...base, qty: 1, area_m2: 1, cost: 500 }, { ...base, order_id: 2, qty: 2, area_m2: 2, cost: null }]))
      .toMatchObject({ orders: 2, pieces: 3, area: 3, cost: 500, noRate: 1, away: 3 })
    expect(materialSummary([
      { material: 'М1', thickness: 8, qty: 1, area_m2: 1 }, { material: 'М1', thickness: 8, qty: 2, area_m2: 2 }, { material: 'М1', thickness: 6, qty: 1, area_m2: 1 },
    ])).toEqual([{ material: 'М1', thickness: 6, pieces: 1, area: 1 }, { material: 'М1', thickness: 8, pieces: 3, area: 3 }])
  })
})
