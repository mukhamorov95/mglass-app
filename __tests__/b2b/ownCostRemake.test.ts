import { describe, expect, it } from 'vitest'
import { billableTotal, ownCostRemakeLabel, ownCostRemakeOf } from '@/lib/b2b/ownCostRemake'

describe('переделка за наш счёт', () => {
  it('читается из notes строкой и объектом', () => {
    const notes = { own_cost_remake: { of: '05722', by: 'Администратор', at: '2026-11-12T19:00:00Z' } }
    expect(ownCostRemakeOf(notes)).toEqual({ of: '05722', by: 'Администратор', at: '2026-11-12T19:00:00Z' })
    expect(ownCostRemakeOf(JSON.stringify(notes))?.of).toBe('05722')
  })
  it('нет отметки или она снята — заказ обычный', () => {
    expect(ownCostRemakeOf({})).toBeNull()
    expect(ownCostRemakeOf({ own_cost_remake: null })).toBeNull()
    expect(ownCostRemakeOf('не json')).toBeNull()
  })
  it('к оплате ноль, у обычного заказа — его итог', () => {
    expect(billableTotal(16623, { own_cost_remake: { of: '05722' } })).toBe(0)
    expect(billableTotal(16623, { repeated_from: 5722 })).toBe(16623)
  })
  it('подпись называет исходный заказ', () => {
    expect(ownCostRemakeLabel({ of: '05722', by: null, at: null })).toBe('За счёт M GLASS, переделка 05722')
  })
})

describe('за счёт M GLASS не входит в долг', async () => {
  const { computeReceivables } = await import('@/lib/money/receivables')
  const { summarizeOrders } = await import('@/lib/b2b/ordersFilter')
  const { shipmentTotals } = await import('@/lib/production/clientShipments')
  const remake = JSON.stringify({ own_cost_remake: { of: '05722' }, stages: { shipped: '2026-11-12T12:00:00+03:00' } })
  const order = (id: number, notes: string | null) => ({ id, custom_number: `0${id}`, client_id: 2, client_name: 'ShowerGlass', launched_at: '2026-11-11T09:00:00Z', total_after_discount: 16623, total_sale_inc_vat: 18470, notes })

  it('дебиторка: переделку пропускает, обычный заказ считает', () => {
    const rec = computeReceivables([order(5915, remake), order(5909, null)] as never, new Map(), { today: '2026-11-12' })
    expect(rec.rows.map(r => r.id)).toEqual([5909])
    expect(rec.total).toBe(16623)
  })
  it('итог выборки: сумма есть, но ни в оплаченных, ни в неоплаченных', () => {
    const s = summarizeOrders([{ v: 16623, p: 'own_cost' as const }, { v: 1000, p: 'unpaid' as const }], o => o.v, () => true, o => o.p)
    expect(s.all).toEqual({ count: 2, sum: 17623 })
    expect(s.ownCost).toEqual({ count: 1, sum: 16623 })
    expect(s.unpaid).toEqual({ count: 1, sum: 1000 })
  })
  it('лист отгрузки: строка за счёт M GLASS едет и весит, но в сумму не входит', () => {
    const t = shipmentTotals([{ order_id: 5915, qty: 1, weight: 20.5, amount: 16623, own_cost: true }, { order_id: 5808, qty: 2, weight: 27.9, amount: 4462 }])
    expect(t).toEqual({ orders: 2, pieces: 3, weight: 48.4, amount: 4462 })
  })
})
