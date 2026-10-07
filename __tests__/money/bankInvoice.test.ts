import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { matchInvoice, rowEffect, searchInvoices, type OpenInvoice } from '@/lib/accounting/bankMatch'
import { postBankRow, loadOpenInvoices, type BankRow } from '@/lib/accounting/bankPost'
import { loadPostedPaymentIds } from '@/lib/accounting/postedPayments'
import { MANUAL_SOURCE } from '@/lib/money/invoiceManualPayment'
import { makeDb, fakeClient, type FakeDb } from './fakeSupabase'

const inv = (o: Partial<OpenInvoice>): OpenInvoice => ({
  id: 1, no: '57', payer: 'ООО Ромашка', inn: '7700000001', amount: 100000, paid: 0, remainder: 100000, orders: [10], issued_at: '2026-09-01', ...o,
})

describe('подбор счёта к строке выписки — против остатка', () => {
  it('строка меньше остатка — частичная оплата, счёт не закрывается', () => {
    const m = matchInvoice({ amount: 40000, inn: '7700000001', purpose: 'Оплата по счёту № 57 от 01.09' }, [inv({})])
    expect(m).toMatchObject({ invoice: { id: 1 }, partial: true, rest: 60000, over: 0 })
  })

  it('вторая половина равна остатку, а не сумме счёта — находится по ИНН и сумме', () => {
    const m = matchInvoice({ amount: 60000, inn: '7700000001', purpose: 'доплата' }, [inv({ paid: 40000, remainder: 60000 })])
    expect(m).toMatchObject({ invoice: { id: 1 }, partial: false, rest: 0 })
  })

  it('сумма больше остатка — не автоподбор (решает человек)', () => {
    expect(matchInvoice({ amount: 100000, inn: '7700000001', purpose: 'счёт 57' }, [inv({ paid: 40000, remainder: 60000 })])).toBeNull()
  })

  it('одна сумма без ИНН и номера — не признак', () => {
    expect(matchInvoice({ amount: 100000, inn: null, purpose: 'оплата' }, [inv({})])).toBeNull()
  })

  it('два счёта одного плательщика — решает номер в назначении', () => {
    const list = [inv({ id: 1, no: '57' }), inv({ id: 2, no: '58' })]
    expect(matchInvoice({ amount: 100000, inn: '7700000001', purpose: 'оплата' }, list)).toBeNull()
    expect(matchInvoice({ amount: 100000, inn: '7700000001', purpose: 'по счёту 58' }, list)?.invoice.id).toBe(2)
  })

  it('номер «5» не цепляется к «57»', () => {
    expect(matchInvoice({ amount: 100000, inn: null, purpose: 'счёт 57' }, [inv({ no: '5' })])).toBeNull()
  })

  it('переплата считается, остаток не уходит в минус', () => {
    expect(rowEffect(60000, 61000)).toEqual({ partial: false, over: 1000, rest: 0 })
  })

  it('ручной поиск: номер, плательщик, сумма; без запроса — ближайшие по остатку', () => {
    const list = [inv({ id: 1, no: '57', remainder: 100000 }), inv({ id: 2, no: '61', payer: 'ИП Петров', remainder: 25000, amount: 25000, inn: '500100' })]
    expect(searchInvoices(list, '61', 0).map(i => i.id)).toEqual([2])
    expect(searchInvoices(list, 'петров', 0).map(i => i.id)).toEqual([2])
    expect(searchInvoices(list, '25 000', 0).map(i => i.id)).toEqual([2])
    expect(searchInvoices(list, '', 24000).map(i => i.id)).toEqual([2, 1])
  })
})

const svc = (db: FakeDb) => fakeClient(db) as unknown as SupabaseClient
const me = { id: 'u-acc', name: 'Бухгалтер' }
const row = (o: Partial<BankRow> = {}): BankRow => ({
  id: 1, unit: 'ooo', external_key: 'k1', op_date: '2026-10-06', amount: 40000, direction: 'in',
  counterparty: 'ООО Ромашка', purpose: 'Оплата по счёту № 57', account: null, status: 'new', ...o,
})
const base = (extra: Record<string, Record<string, unknown>[]> = {}) => makeDb({
  invoices: [{ id: 1, invoice_no: '57', amount: 100000, order_ids: [10], status: 'issued', payer_client_id: 5, payer_name: 'ООО Ромашка', issued_at: '2026-09-01' }],
  b2b_clients: [{ id: 5, inn: '7700000001' }],
  bank_statement_rows: [{ id: 1, status: 'new' }, { id: 2, status: 'new' }],
  payments: [], cashflow_entries: [], payment_requests: [],
  ...extra,
})
const input = { fundId: 3, subfundId: null, account: null, requestId: null, invoiceId: 1 }

describe('проведение строки выписки по счёту', () => {
  it('частичная оплата: платёж «предоплата», счёт остаётся неоплаченным, операция ДДС ссылается на платёж', async () => {
    const db = base()
    const r = await postBankRow(svc(db), row(), input, me)
    expect(r).toMatchObject({ ok: true, invoice: { partial: true, rest: 60000 } })
    const pay = db.tables.payments[0]
    expect(pay).toMatchObject({ amount: 40000, kind: 'prepayment', invoice_id: 1, b2b_order_id: 10, source: 'bank_statement_import' })
    expect(db.tables.cashflow_entries[0]).toMatchObject({ payment_id: pay.id, amount: 40000, kind: 'in' })
    expect(db.tables.invoices[0].status).toBe('issued')
    expect(db.tables.bank_statement_rows[0]).toMatchObject({ status: 'posted', payment_id: pay.id, invoice_id: 1 })

    const r2 = await postBankRow(svc(db), row({ id: 2, external_key: 'k2', amount: 60000 }), input, me)
    expect(r2).toMatchObject({ ok: true, invoice: { partial: false, rest: 0 } })
    expect(db.tables.payments[1]).toMatchObject({ kind: 'remainder', amount: 60000 })
    expect(db.tables.invoices[0].status).toBe('paid')
    expect((await loadOpenInvoices(svc(db))).length).toBe(0)
  })

  it('ручная отметка «Оплачен» заменяется фактом из банка, а не копит переплату', async () => {
    const db = base({ payments: [{ id: 7, amount: 100000, invoice_id: 1, b2b_order_id: 10, source: MANUAL_SOURCE, external_key: 'invoice:1:manual:0', voided_at: null, paid_at: '2026-10-01' }] })
    db.tables.invoices[0].status = 'paid'
    const r = await postBankRow(svc(db), row({ amount: 100000 }), input, me)
    expect(r).toMatchObject({ ok: true, invoice: { replaced: 1, partial: false } })
    expect(db.tables.payments.find(p => p.id === 7)!.voided_at).not.toBeNull()
    expect(db.tables.payments.filter(p => !p.voided_at).map(p => p.source)).toEqual(['bank_statement_import'])
    expect(db.tables.invoices[0].status).toBe('paid')
  })

  it('счёт уже оплачен деньгами по заказу — отказ без единой записи', async () => {
    const db = base({ payments: [{ id: 7, amount: 100000, invoice_id: null, b2b_order_id: 10, source: 'b2b_order_manual', external_key: 'x', voided_at: null }] })
    const r = await postBankRow(svc(db), row({ amount: 100000 }), input, me)
    expect(r).toMatchObject({ ok: false, status: 409 })
    expect(db.tables.cashflow_entries).toHaveLength(0)
    expect(db.tables.payments).toHaveLength(1)
    expect(db.tables.bank_statement_rows[0].status).toBe('new')
  })

  it('платёж не записался — 500, операции ДДС нет, строка не проведена', async () => {
    const db = base()
    const c = fakeClient(db)
    const broken = { ...c, from(t: string) {
      const b = c.from(t)
      if (t === 'payments') { const up = b.upsert; b.upsert = (...a: Parameters<typeof up>) => { db.failTable = 'payments'; return up(...a) } }
      return b
    } } as unknown as SupabaseClient
    const r = await postBankRow(broken, row(), input, me)
    expect(r).toMatchObject({ ok: false, status: 500 })
    expect(db.tables.cashflow_entries).toHaveLength(0)
    expect(db.tables.bank_statement_rows[0].status).toBe('new')
  })

  it('повтор после сбоя — тот же платёж (ключ строки), не второй', async () => {
    const db = base()
    await postBankRow(svc(db), row(), input, me)
    db.tables.bank_statement_rows[0].status = 'new'
    db.tables.cashflow_entries = []
    const r = await postBankRow(svc(db), row(), input, me)
    expect(r).toMatchObject({ ok: true, invoice: { partial: true, rest: 60000 } })
    expect(db.tables.payments).toHaveLength(1)
  })

  it('расход и приход без счёта — только операция ДДС', async () => {
    const db = base()
    const r = await postBankRow(svc(db), row({ direction: 'out' }), input, me)
    expect(r).toMatchObject({ ok: true, paymentId: null, invoice: null })
    expect(db.tables.payments).toHaveLength(0)
    expect(db.tables.cashflow_entries[0]).toMatchObject({ kind: 'out', payment_id: null })
  })
})

describe('проведённые платежи — без потолка 1000 строк', () => {
  it('1500 операций с payment_id читаются все', async () => {
    const db = makeDb({ cashflow_entries: Array.from({ length: 1500 }, (_, i) => ({ id: i + 1, payment_id: 5000 + i })) })
    expect((await loadPostedPaymentIds(svc(db))).size).toBe(1500)
  })
})
