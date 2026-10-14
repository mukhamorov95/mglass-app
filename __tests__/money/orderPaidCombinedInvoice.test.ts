import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { makeDb, fakeClient, type FakeDb } from './fakeSupabase'
import { loadOrderPaid } from '@/lib/money/orderPaid'

// 14.10: сводный счёт «05167–05400» на 10 заказов оплачен из выписки. Экран заказов спрашивал
// оплату только по видимым заказам, и весь счёт ложился на них: заказ на 4 802 ₽ показал
// «оплачено 101 767». Доля считается от итогов всех заказов счёта, видны они или нет.

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb }))

vi.mock('@/lib/apiAuth', () => ({ requireRole: async () => 'manager' }))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => fakeClient(h.db) }))

import { GET } from '@/app/api/b2b-orders/payments/route'

const order = (id: number, total: number) => ({ id, total_after_discount: total, total_sale_inc_vat: total, archived_at: null, created_at: '2026-09-01' })

beforeEach(() => {
  h.db = makeDb({
    b2b_orders: [order(5167, 4802), order(5171, 12503), order(5400, 9789)],
    invoices: [{ id: 60, order_ids: ['5167', '5171', '5400'], amount: 27094 }],
    payments: [{ id: 1, amount: 27094, invoice_id: 60, b2b_order_id: null, voided_at: null, source: 'bank_statement_import', entered_by_name: null, paid_at: '2026-09-24' }],
  })
})

async function paidFor(ids: number[]) {
  const res = await GET(new NextRequest(`http://localhost/api/b2b-orders/payments?ids=${ids.join(',')}`))
  return (await res.json() as { paid: Record<string, number> }).paid
}

describe('оплата сводного счёта по заказам', () => {
  it('на экране один заказ из трёх — ему только его доля', async () => {
    expect(await paidFor([5167])).toEqual({ 5167: 4802 })
  })

  it('на экране все — каждому ровно его итог', async () => {
    expect(await paidFor([5167, 5171, 5400])).toEqual({ 5167: 4802, 5171: 12503, 5400: 9789 })
  })

  it('карточка сделки (loadOrderPaid) — та же доля', async () => {
    const m = await loadOrderPaid(fakeClient(h.db) as never, new Map([[5167, 4802]]))
    expect(m.get(5167)).toBe(4802)
  })
})
