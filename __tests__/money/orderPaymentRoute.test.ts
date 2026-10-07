import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { makeDb, fakeClient, type FakeDb } from './fakeSupabase'

// Ручное «Оплачен» по заказу раньше писало весь остаток, вычитая только старую
// предоплату из notes, и не видело платежей из payments: деньги из выписки + кнопка
// менеджера = двойная оплата заказа.

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb }))

vi.mock('@/lib/supabase-server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: '00000000-0000-0000-0000-000000000001' } } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: 'manager', name: 'Яна' }, error: null }) }) }) }),
  }),
}))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => fakeClient(h.db) }))
vi.mock('@/lib/salesLedger', () => ({ upsertSaleFromB2B: async () => null, voidSale: async () => undefined }))
vi.mock('@/lib/b2b/notifyManager', () => ({ notifyOrderManager: async () => true }))

import { POST } from '@/app/api/b2b-orders/[id]/payment/route'

const order = (id: number, total: number) => ({ id, custom_number: `0${id}`, client_name: 'Клиент', total_after_discount: total, total_sale_inc_vat: total, notes: '{}', created_by_name: 'Яна' })
const pay = (o: Record<string, unknown>) => ({ voided_at: null, invoice_id: null, b2b_order_id: null, paid_at: '2026-10-01', ...o })

async function call(id: number, body: Record<string, unknown>) {
  const res = await POST(new NextRequest(`http://localhost/api/b2b-orders/${id}/payment`, { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ id: String(id) }) })
  return { status: res.status, body: await res.json() as { ok?: boolean; alreadyPaid?: boolean; warnings?: string[]; error?: string } }
}
const live = () => h.db.tables.payments.filter(p => !p.voided_at)

beforeEach(() => {
  h.db = makeDb({ b2b_orders: [order(10, 50000), order(11, 50000)], payments: [], invoices: [] })
})

describe('«Оплачен» по заказу видит платежи из payments', () => {
  it('платёж из выписки уже есть, менеджер жмёт «Оплачен» — второго платежа нет', async () => {
    h.db.tables.invoices.push({ id: 5, order_ids: [10], amount: 50000, status: 'paid' })
    h.db.tables.payments.push(pay({ id: 1, amount: 50000, invoice_id: 5, b2b_order_id: 10, external_key: 'bank:ip:abc', source: 'bank_statement_import' }))
    const { status, body } = await call(10, { status: 'paid' })
    expect(status).toBe(200)
    expect(body.alreadyPaid).toBe(true)
    expect(body.warnings?.[0]).toMatch(/уже пришло 50\s000 ₽ из 50\s000 ₽/)
    expect(live()).toHaveLength(1)
  })

  it('выписка по общему счёту на два заказа — «Оплачен» дописывает только долю, которой не хватает', async () => {
    h.db.tables.invoices.push({ id: 6, order_ids: [10, 11], amount: 100000, status: 'issued' })
    h.db.tables.payments.push(pay({ id: 1, amount: 60000, invoice_id: 6, external_key: 'bank:ip:x' }))
    await call(10, { status: 'paid' })
    const settle = live().find(p => p.external_key === 'b2b:10:settlement')
    expect(settle).toMatchObject({ amount: 20000, kind: 'remainder' })   // 50 000 − половина от 60 000
  })

  it('платежей нет — пишется весь итог; двойной клик не задваивает', async () => {
    await call(10, { status: 'paid' })
    await call(10, { status: 'paid' })
    expect(live()).toHaveLength(1)
    expect(live()[0]).toMatchObject({ external_key: 'b2b:10:settlement', amount: 50000, kind: 'full' })
  })

  it('была предоплата — остаток = итог − предоплата', async () => {
    await call(10, { status: 'partial', amount: 15000 })
    await call(10, { status: 'paid' })
    const settle = live().find(p => p.external_key === 'b2b:10:settlement')
    expect(settle).toMatchObject({ amount: 35000, kind: 'remainder' })
    expect(live().reduce((s, p) => s + Number(p.amount), 0)).toBe(50000)
  })

  it('отметка «остаток» была, потом пришла выписка — лишняя отметка снимается', async () => {
    await call(10, { status: 'paid' })
    h.db.tables.payments.push(pay({ id: 99, amount: 50000, b2b_order_id: 10, external_key: 'bank:ip:late' }))
    const { body } = await call(10, { status: 'paid' })
    expect(body.alreadyPaid).toBe(true)
    expect(live().map(p => p.external_key)).toEqual(['bank:ip:late'])
  })

  it('снятие оплаты войдит платежи (voided_by — uuid, не имя)', async () => {
    await call(10, { status: 'paid' })
    await call(10, { status: 'unpaid' })
    expect(live()).toHaveLength(0)
    expect(h.db.tables.payments[0].voided_by).toBe('00000000-0000-0000-0000-000000000001')
  })
})
