import { describe, it, expect } from 'vitest'
import { partnerOrders, partnerShipments } from '@/lib/partner/shipmentsView'
import type { PoolOrder, Shipment } from '@/app/production-app/shower-glass/types'

const order = (over: Partial<PoolOrder> = {}): PoolOrder => ({
  id: 1, no: '05915', client_no: '12', urgent_rank: null, urgent_lines: null, launch_day: '2026-11-01', deadline_day: '2026-11-10', overdue_days: 0,
  paid: false, state: 'none', stage: 'in_work', packed_lines: 0, marked_day: null, marked_outside: true, hidden: null, archived_day: null, rest_off: true,
  lines: [{ key: 'a', label: 'Стекло', size: '500×1900', qty: 2, weight: 20, amount: 4000, shipped: 1, drafted: 1, earlier: 0, free: 0, packed: false }],
  ...over,
})

describe('shipmentsView', () => {
  it('скрытые заказы не уходят, внутренние пометки срезаны', () => {
    const v = partnerOrders([order(), order({ id: 2, hidden: 'archived' })], true)
    expect(v.map(o => o.id)).toEqual([1])
    const json = JSON.stringify(v)
    for (const k of ['marked_outside', 'rest_off', 'drafted', 'free', 'earlier', 'hidden', 'paid']) expect(json).not.toContain(k)
    expect(v[0].lines[0].amount).toBe(4000)
  })
  it('без права «цены» сумм нет', () => {
    expect(partnerOrders([order()], false)[0].lines[0]).not.toHaveProperty('amount')
  })
  it('срочный — только пока не отгружен', () => {
    expect(partnerOrders([order({ urgent_rank: 1 })], false)[0].urgent).toBe(true)
    expect(partnerOrders([order({ urgent_rank: 1, stage: 'shipped' })], false)[0].urgent).toBe(false)
  })
  it('черновики отгрузок — наш план, партнёру не показываются', () => {
    const line = { order_id: 1, order_no: '05915', client_no: null, own_cost: true, key: 'a', label: 'Стекло', size: '', qty: 1, lineQty: 2, weight: 10, amount: 2000 }
    const list: Shipment[] = [{ id: 1, ship_date: '2026-11-19', status: 'shipped', shipped_at: null, lines: [line] }, { id: 2, ship_date: '2026-11-25', status: 'draft', shipped_at: null, lines: [line] }]
    expect(partnerShipments(list, true).map(s => s.id)).toEqual([1])
    expect(partnerShipments(list, false)[0].lines[0]).not.toHaveProperty('amount')
  })
})
