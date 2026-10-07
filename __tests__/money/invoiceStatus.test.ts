import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  invoicePayments, invoicePayment, payState, columnStatusFor, manualPaymentKind, checkManualAmount, invoiceVat,
  type PaymentLike,
} from '@/lib/money/invoiceStatus'
import { payInvoice, unpayInvoice, MANUAL_SOURCE } from '@/lib/money/invoiceManualPayment'
import { makeDb, fakeClient } from './fakeSupabase'

let pid = 0
const P = (o: Partial<PaymentLike>): PaymentLike => ({ id: ++pid, amount: 0, invoice_id: null, b2b_order_id: null, voided_at: null, ...o })

describe('статус счёта из платежей', () => {
  it('ждёт оплаты, частично, оплачен — по сумме невойднутых платежей', () => {
    expect(payState(10000, 0).derivedStatus).toBe('unpaid')
    expect(payState(10000, 4000)).toMatchObject({ derivedStatus: 'partial', paid: 4000, remainder: 6000 })
    expect(payState(10000, 10000)).toMatchObject({ derivedStatus: 'paid', remainder: 0 })
    expect(payState(10000, 9999.6).derivedStatus).toBe('paid')   // копейки округления — не долг
    expect(payState(10000, 12000)).toMatchObject({ derivedStatus: 'paid', remainder: 0 })
  })

  it('одно-заказный счёт оплачен платежом по заказу (так закрыты 37 счетов на проде)', () => {
    const inv = { id: 1, amount: 50000, order_ids: [10] }
    const st = invoicePayment(inv, [P({ amount: 50000, b2b_order_id: 10 })])
    expect(st.derivedStatus).toBe('paid')
  })

  it('платёж с invoice_id — только своему счёту, даже если заказ есть в другом', () => {
    const a = { id: 1, amount: 1000, order_ids: [10] }
    const b = { id: 2, amount: 1000, order_ids: [10, 11] }
    const map = invoicePayments([a, b], [P({ amount: 1000, invoice_id: 2, b2b_order_id: 10 })])
    expect(map.get(1)!.derivedStatus).toBe('unpaid')
    expect(map.get(2)!.derivedStatus).toBe('paid')
  })

  it('мульти-заказный счёт: платежи по двум заказам складываются', () => {
    const inv = { id: 3, amount: 3000, order_ids: [10, 11] }
    expect(invoicePayment(inv, [P({ amount: 1000, b2b_order_id: 10 })])).toMatchObject({ derivedStatus: 'partial', remainder: 2000 })
    expect(invoicePayment(inv, [P({ amount: 1000, b2b_order_id: 10 }), P({ amount: 2000, b2b_order_id: 11 })]).derivedStatus).toBe('paid')
  })

  it('войднутые платежи не считаются; один платёж, прочитанный дважды, — один раз', () => {
    const inv = { id: 4, amount: 1000, order_ids: [10] }
    const p = P({ amount: 600, b2b_order_id: 10 })
    expect(invoicePayment(inv, [p, p]).paid).toBe(600)
    expect(invoicePayment(inv, [P({ amount: 1000, b2b_order_id: 10, voided_at: '2026-10-01' })]).derivedStatus).toBe('unpaid')
  })

  it('дата оплаты — последний платёж', () => {
    const inv = { id: 5, amount: 1000, order_ids: [10] }
    const st = invoicePayment(inv, [P({ amount: 500, b2b_order_id: 10, paid_at: '2026-10-02' }), P({ amount: 500, b2b_order_id: 10, paid_at: '2026-10-05' })])
    expect(st.lastPaidAt).toBe('2026-10-05')
  })

  it('колонка статуса следует за платежами, отмену не трогает', () => {
    expect(columnStatusFor('issued', 'paid')).toBe('paid')
    expect(columnStatusFor('paid', 'paid')).toBeNull()
    expect(columnStatusFor('paid', 'partial')).toBe('issued')
    expect(columnStatusFor('issued', 'unpaid')).toBeNull()
    expect(columnStatusFor('cancelled', 'paid')).toBeNull()
  })

  it('вид и сумма ручного платежа', () => {
    expect(manualPaymentKind(0, 1000, 1000)).toBe('full')
    expect(manualPaymentKind(500, 500, 500)).toBe('remainder')
    expect(manualPaymentKind(0, 300, 1000)).toBe('prepayment')
    expect(checkManualAmount('1 000,50', 2000)).toEqual({ ok: true, amount: 1000.5 })
    expect(checkManualAmount('0', 2000).ok).toBe(false)
    expect(checkManualAmount('abc', 2000).ok).toBe(false)
    expect(checkManualAmount(2500, 2000).ok).toBe(false)
    expect(checkManualAmount(100, 0).ok).toBe(false)
  })

  it('НДС 22 % в сумме счёта — до копейки', () => {
    expect(invoiceVat(12200)).toBe(2200)
    expect(invoiceVat(1000)).toBe(180.33)
  })
})

describe('ручное «Оплачен» по счёту', () => {
  const setup = () => {
    const db = makeDb({
      invoices: [{ id: 7, invoice_no: '0450', amount: 30000, order_ids: [10], status: 'issued' }],
      payments: [],
    })
    return { db, svc: fakeClient(db) as unknown as SupabaseClient }
  }

  it('записывает платёж на остаток и ставит статус «оплачен»', async () => {
    const { db, svc } = setup()
    db.tables.payments.push({ id: 1, amount: 10000, b2b_order_id: 10, invoice_id: null, voided_at: null, paid_at: '2026-10-01', external_key: 'b2b:10:prepayment' })
    const res = await payInvoice(svc, 7, { actorId: null, actorName: 'Тест' })
    expect(res.ok).toBe(true)
    const manual = db.tables.payments.filter(p => p.source === MANUAL_SOURCE)
    expect(manual).toHaveLength(1)
    expect(manual[0]).toMatchObject({ amount: 20000, invoice_id: 7, b2b_order_id: 10, kind: 'remainder' })
    expect(db.tables.invoices[0].status).toBe('paid')
  })

  it('платежи уже покрывают счёт — второго платежа нет, ответ «уже оплачен»', async () => {
    const { db, svc } = setup()
    db.tables.payments.push({ id: 1, amount: 30000, b2b_order_id: 10, invoice_id: null, voided_at: null, paid_at: '2026-10-01', external_key: 'bank:ip:1' })
    const res = await payInvoice(svc, 7, { actorId: null, actorName: 'Тест' })
    expect(res.ok).toBe(false)
    if (!res.ok) { expect(res.status).toBe(409); expect(res.error).toMatch(/уже оплачен/) }
    expect(db.tables.payments).toHaveLength(1)
    expect(db.tables.invoices[0].status).toBe('paid')   // колонка приведена к платежам
  })

  it('частичная сумма — счёт остаётся «ждёт», двойной клик не задваивает', async () => {
    const { db, svc } = setup()
    await payInvoice(svc, 7, { amount: 5000, actorId: null, actorName: 'Тест' })
    expect(db.tables.invoices[0].status).toBe('issued')
    const res = await payInvoice(svc, 7, { amount: 50000, actorId: null, actorName: 'Тест' })
    expect(res.ok).toBe(false)   // больше остатка
    expect(db.tables.payments).toHaveLength(1)
  })

  it('снять ручную оплату: платёж войднут, статус вернулся', async () => {
    const { db, svc } = setup()
    await payInvoice(svc, 7, { actorId: null, actorName: 'Тест' })
    const res = await unpayInvoice(svc, 7, null)
    expect(res.ok).toBe(true)
    expect(db.tables.payments[0].voided_at).toBeTruthy()
    expect(db.tables.invoices[0].status).toBe('issued')
  })

  it('отменённый счёт не оплачивается', async () => {
    const { db, svc } = setup()
    db.tables.invoices[0].status = 'cancelled'
    const res = await payInvoice(svc, 7, { actorId: null, actorName: 'Тест' })
    expect(res.ok).toBe(false)
    expect(db.tables.payments).toHaveLength(0)
  })
})
