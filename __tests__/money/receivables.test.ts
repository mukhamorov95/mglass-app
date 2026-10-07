import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { computeReceivables, expectedInflow, expectedPayDay, type RecOrder } from '@/lib/money/receivables'
import { loadReceivables } from '@/lib/money/receivablesLoad'
import { makeDb, fakeClient } from './fakeSupabase'

const O = (o: Partial<RecOrder> & { id: number }): RecOrder => ({
  custom_number: `0${o.id}`, client_id: 1, client_name: 'Альфа', launched_at: '2026-09-01T09:00:00Z',
  total_after_discount: 10000, total_sale_inc_vat: 10000, notes: '{}', ...o,
})
const TODAY = '2026-10-07'

describe('долг клиентов — одна функция', () => {
  it('итог − оплачено, только положительные; полностью оплаченные и копейки — не долг', () => {
    const rec = computeReceivables(
      [O({ id: 1 }), O({ id: 2 }), O({ id: 3 }), O({ id: 4 })],
      new Map([[2, 4000], [3, 10000], [4, 9999.5]]),
      { today: TODAY },
    )
    expect(rec.rows.map(r => [r.id, r.debt])).toEqual([[1, 10000], [2, 6000]])
    expect(rec.total).toBe(16000)
    expect(rec.coverage).toEqual({ orders: 4, withPayment: 3 })
  })

  it('незапущенные, запущенные до границы и шаблоны — не в долге', () => {
    const rec = computeReceivables([
      O({ id: 1, launched_at: null }),
      O({ id: 2, launched_at: '2026-08-20T10:00:00Z' }),
      O({ id: 3, notes: JSON.stringify({ is_template: true }) }),
      O({ id: 4 }),
    ], new Map(), { today: TODAY })
    expect(rec.rows.map(r => r.id)).toEqual([4])
    expect(rec.coverage.orders).toBe(1)
  })

  it('итог — договорная сумма, иначе прайс (как в orderPayments)', () => {
    const rec = computeReceivables([O({ id: 1, total_after_discount: 0, total_sale_inc_vat: 7000 })], new Map(), { today: TODAY })
    expect(rec.rows[0].debt).toBe(7000)
  })

  it('срок — с отгрузки, а без неё — с запуска; ведро по дням', () => {
    const rec = computeReceivables([
      O({ id: 1, launched_at: '2026-09-01T09:00:00Z', notes: JSON.stringify({ stages: { shipped: '2026-10-01' } }) }),
      O({ id: 2, launched_at: '2026-09-01T09:00:00Z' }),
    ], new Map(), { today: TODAY })
    const byId = new Map(rec.rows.map(r => [r.id, r]))
    expect(byId.get(1)).toMatchObject({ fromDay: '2026-10-01', shipped: true, days: 6, bucket: 'b7' })
    expect(byId.get(2)).toMatchObject({ fromDay: '2026-09-01', shipped: false, days: 36, bucket: 'b99' })
    expect(rec.buckets.find(b => b.key === 'b99')).toMatchObject({ sum: 10000, count: 1 })
  })

  it('разбивка по клиенту', () => {
    const rec = computeReceivables([
      O({ id: 1, client_id: 1, client_name: 'Альфа' }), O({ id: 2, client_id: 1, client_name: 'Альфа' }),
      O({ id: 3, client_id: 2, client_name: 'Бета', total_after_discount: 50000 }),
    ], new Map(), { today: TODAY })
    expect(rec.byClient.map(c => [c.client, c.debt, c.count])).toEqual([['Бета', 50000, 1], ['Альфа', 20000, 2]])
  })

  it('прогноз кассы: срок 14 дней, просроченное — в ближайшие дни', () => {
    expect(expectedPayDay({ fromDay: '2026-10-01' }, TODAY)).toBe('2026-10-15')
    expect(expectedPayDay({ fromDay: '2026-09-01' }, TODAY)).toBe('2026-10-10')
    expect(expectedInflow([{ fromDay: '2026-09-01', debt: 100 }, { fromDay: '2026-10-01', debt: 50 }, { fromDay: '2026-09-25', debt: 7 }], TODAY)).toBe(107)
  })
})

describe('loadReceivables — без потолка 1000 строк', () => {
  it('1200 запущенных заказов: долг у всех, платёж по общему счёту делится по суммам', async () => {
    const orders: Record<string, unknown>[] = Array.from({ length: 1200 }, (_, i) => ({ ...O({ id: i + 1 }), archived_at: null }))
    orders.push({ ...O({ id: 5000 }), archived_at: '2026-09-10' })
    const db = makeDb({
      b2b_orders: orders,
      invoices: [{ id: 1, invoice_no: 'С-1', order_ids: [1, 2], amount: 20000, status: 'issued' }],
      payments: [{ id: 1, amount: 10000, invoice_id: 1, b2b_order_id: null, voided_at: null }],
    })
    const rec = await loadReceivables(fakeClient(db) as unknown as SupabaseClient, { today: TODAY })
    expect(rec.coverage.orders).toBe(1200)
    expect(rec.count).toBe(1200)
    expect(rec.total).toBe(1200 * 10000 - 10000)
    const r1 = rec.rows.find(r => r.id === 1)!
    expect(r1).toMatchObject({ paid: 5000, debt: 5000, invoiceNo: 'С-1' })
    expect(rec.rows.find(r => r.id === 3)!.invoiceNo).toBeNull()
  })
})
