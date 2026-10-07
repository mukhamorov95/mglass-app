import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { invoiceChanges, overlappingOpen, overlapMessage, syncInvoicesForOrders, type OpenInvoice } from '@/lib/money/invoiceSync'
import { makeDb, fakeClient, type FakeDb } from './fakeSupabase'

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb, role: 'admin' }))
vi.mock('@/lib/supabase-server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u-1', email: 'a@b' } } }) },
    from: (t: string) => t === 'users'
      ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: h.role, name: 'Вера' }, error: null }) }) }) }
      : fakeClient(h.db).from(t),
  }),
}))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => fakeClient(h.db) }))

import { POST } from '@/app/api/invoices/route'

const head = { amount: 10000, vat: 1803.28, payer_client_id: 1, payer_entity_id: 5, payer_name: 'ООО Альфа' }
const open = (o: Partial<OpenInvoice>): OpenInvoice => ({ id: 1, invoice_no: '0450', order_ids: [10], status: 'issued', derivedStatus: 'unpaid', ...o })

describe('счёт следует за заказом, пока не оплачен', () => {
  it('ничего не поменялось — патча нет; НДС, округлённый до рубля другим экраном, — не правка', () => {
    expect(invoiceChanges(head, { amount: 10000, vat: 1803, payer_entity_id: 5, payer_name: 'ООО Альфа' })).toBeNull()
  })
  it('новая сумма — сумма и НДС', () => {
    expect(invoiceChanges(head, { amount: 12200 })).toEqual({ amount: 12200, vat: 2200 })
  })
  it('сменили юрлицо плательщика', () => {
    expect(invoiceChanges(head, { payer_entity_id: 6, payer_name: 'ИП Бета' })).toEqual({ payer_entity_id: 6, payer_name: 'ИП Бета' })
  })
  it('пустое имя плательщика не затирает записанное', () => {
    expect(invoiceChanges(head, { payer_name: '' })).toBeNull()
  })
})

describe('заказ — не больше чем в одном неоплаченном счёте', () => {
  it('пересечение с неоплаченным счётом находится, с оплаченным и отменённым — нет', () => {
    const hits = overlappingOpen([10, 11], [
      open({ id: 1, invoice_no: 'A', order_ids: [10] }),
      open({ id: 2, invoice_no: 'B', order_ids: [11], derivedStatus: 'paid' }),
      open({ id: 3, invoice_no: 'C', order_ids: [11], status: 'cancelled' }),
    ])
    expect(hits.map(h => h.invoice.invoice_no)).toEqual(['A'])
    expect(overlapMessage(hits, id => `0${id}`)).toMatch(/010 — в счёте № A/)
  })
  it('тот же набор заказов — это тот же счёт, не пересечение', () => {
    expect(overlappingOpen([11, 10], [open({ order_ids: [10, 11] })])).toEqual([])
  })
})

beforeEach(() => {
  h.role = 'admin'
  h.db = makeDb({
    b2b_orders: [
      { id: 10, custom_number: '0450', total_after_discount: 12000, total_sale_inc_vat: 12000 },
      { id: 11, custom_number: '0451', total_after_discount: 8000, total_sale_inc_vat: 8000 },
    ],
    invoices: [], payments: [],
  })
})

describe('после «Изменить сумму» неоплаченный счёт обновляется', () => {
  it('неоплаченный — новая сумма заказов; оплаченный — не трогаем', async () => {
    h.db.tables.invoices.push(
      { id: 1, invoice_no: '0450', order_ids: [10, 11], amount: 15000, vat: 2704.92, status: 'issued' },
      { id: 2, invoice_no: '0450-old', order_ids: [10], amount: 9000, vat: 1622.95, status: 'issued' },
    )
    h.db.tables.payments.push({ id: 1, amount: 9000, invoice_id: 2, b2b_order_id: null, voided_at: null })
    const res = await syncInvoicesForOrders(fakeClient(h.db) as unknown as SupabaseClient, [10])
    expect(res.updated).toEqual([{ id: 1, no: '0450', from: 15000, to: 20000 }])
    expect(res.paidSkipped).toEqual(['0450-old'])
    expect(h.db.tables.invoices[0]).toMatchObject({ amount: 20000, vat: 3606.56 })
    expect(h.db.tables.invoices[1].amount).toBe(9000)
  })
})

async function register(body: Record<string, unknown>) {
  const res = (await POST(new Request('http://localhost/api/invoices', { method: 'POST', body: JSON.stringify(body) })))!
  return { status: res.status, body: await res.json() as Record<string, unknown> }
}

describe('POST /api/invoices', () => {
  it('повторная печать неоплаченного счёта с новой суммой обновляет его, номер не прыгает', async () => {
    h.db.tables.invoices.push({ id: 1, invoice_no: '0450', order_ids: [10], amount: 10000, vat: 1803, status: 'issued', payer_entity_id: 5, payer_name: 'ООО Альфа' })
    const { status, body } = await register({ invoice_no: 'другой', order_ids: [10], amount: 12000, vat: 2164, payer_entity_id: 5, payer_name: 'ООО Альфа' })
    expect(status).toBe(200)
    expect(body).toMatchObject({ id: 1, invoice_no: '0450', existing: true, updated: true })
    expect(h.db.tables.invoices[0]).toMatchObject({ amount: 12000, vat: 2164 })
  })

  it('оплаченный по платежам счёт не переписывается', async () => {
    h.db.tables.invoices.push({ id: 1, invoice_no: '0450', order_ids: [10], amount: 10000, vat: 1803, status: 'issued' })
    h.db.tables.payments.push({ id: 1, amount: 10000, b2b_order_id: 10, invoice_id: null, voided_at: null })
    const { body } = await register({ order_ids: [10], amount: 12000, vat: 2164 })
    expect(body).toMatchObject({ existing: true, updated: false, paid: true })
    expect(h.db.tables.invoices[0].amount).toBe(10000)
  })

  it('единый счёт на заказ, который уже в неоплаченном счёте, — 409 с номерами', async () => {
    h.db.tables.invoices.push({ id: 1, invoice_no: '0450', order_ids: [10], amount: 12000, vat: 2164, status: 'issued' })
    const { status, body } = await register({ invoice_no: '0450–0451', order_ids: [10, 11], amount: 20000, vat: 3606 })
    expect(status).toBe(409)
    expect(String(body.error)).toMatch(/0450 — в счёте № 0450/)
    expect(h.db.tables.invoices).toHaveLength(1)
  })

  it('заказ из оплаченного счёта можно выставить заново', async () => {
    h.db.tables.invoices.push({ id: 1, invoice_no: '0450', order_ids: [10], amount: 12000, vat: 2164, status: 'issued' })
    h.db.tables.payments.push({ id: 1, amount: 12000, b2b_order_id: 10, invoice_id: null, voided_at: null })
    const { status } = await register({ order_ids: [10, 11], amount: 20000, vat: 3606 })
    expect(status).toBe(200)
    expect(h.db.tables.invoices).toHaveLength(2)
  })
})
