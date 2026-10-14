import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { matchInvoice, type OpenInvoice } from '@/lib/accounting/bankMatch'
import { loadOpenInvoices, postBankRow, type BankRow } from '@/lib/accounting/bankPost'
import { autoApplyBank, isLoan, isOwnTransfer } from '@/lib/accounting/bankAuto'
import { makeDb, fakeClient, type FakeDb } from './fakeSupabase'

// Выписка ООО за 01.09–14.10.2026: 23 оплаты клиентов ждали счета, уже закрытые ручным
// «Оплачен» (кнопка заказа → ночная сверка), и подбор их не видел.

const inv = (o: Partial<OpenInvoice>): OpenInvoice => ({
  id: 1, no: '05569', payer: 'ООО Шовер Гласс', inn: null, amount: 6068, paid: 0, remainder: 6068, orders: [5569], issued_at: '2026-09-29', ...o,
})

describe('уверенное совпадение — оплату можно проставить без человека', () => {
  it('номер из пяти цифр в назначении и сумма — уверенно, даже без ИНН', () => {
    const m = matchInvoice({ amount: 6068, inn: '7724425498', purpose: 'Оплата по счет-спецификации № 05569 от 29.09.2026 г.' }, [inv({})])
    expect(m).toMatchObject({ invoice: { id: 1 }, strong: true, partial: false })
  })

  it('ИНН и сумма без номера — подсказка, но не уверенно', () => {
    const m = matchInvoice({ amount: 6068, inn: '7724425498', purpose: 'оплата за стекло' }, [inv({ inn: '7724425498' })])
    expect(m).toMatchObject({ strong: false })
  })

  it('короткий номер без совпавшего ИНН — не уверенно (57 бывает в сумме НДС)', () => {
    const m = matchInvoice({ amount: 6068, inn: null, purpose: 'счёт 57, НДС 1 094,57' }, [inv({ no: '57' })])
    expect(m).toMatchObject({ strong: false })
  })

  it('счёт и итог заказа расходятся на рубли — подбирается (05599: 17 433 / 17 440)', () => {
    const m = matchInvoice({ amount: 17440, inn: null, purpose: 'по счет-спецификации 05599' }, [inv({ no: '05599', amount: 17433, remainder: 17433 })])
    expect(m).toMatchObject({ strong: true, over: 7 })
  })

  it('больше остатка на 3 000 — решает человек (05432: счёт 27 053, пришло 30 053,10)', () => {
    expect(matchInvoice({ amount: 30053.1, inn: null, purpose: 'Оплата по счету №05432' }, [inv({ no: '05432', amount: 27053, remainder: 27053 })])).toBeNull()
  })
})

describe('свои деньги — не выручка', () => {
  it('ИП ↔ ООО и заём', () => {
    expect(isOwnTransfer('668505859957')).toBe(true)
    expect(isOwnTransfer('7716986980')).toBe(true)
    expect(isOwnTransfer('7724425498')).toBe(false)
    expect(isLoan('Перевод средств по дог. процентного займа №1/26')).toBe(true)
    expect(isLoan('Оплата за стекло')).toBe(false)
  })
})

const svc = (db: FakeDb) => fakeClient(db) as unknown as SupabaseClient
const mark = (o: Record<string, unknown> = {}) => ({
  id: 7, amount: 6068, invoice_id: null, b2b_order_id: 5569, source: 'reconcile', method: 'Счёт',
  external_key: 'b2b:5569:settlement', voided_at: null, paid_at: '2026-10-03', ...o,
})
const base = (payments: Record<string, unknown>[] = [mark()]) => makeDb({
  invoices: [{ id: 1, invoice_no: '05569', amount: 6068, order_ids: [5569], status: 'paid', payer_client_id: 5, payer_name: 'ООО "ШОВЕР ГЛАСС"', issued_at: '2026-09-29' }],
  b2b_clients: [{ id: 5, inn: null }],
  bank_statement_rows: [
    { id: 1, unit: 'ooo', external_key: 'k1', op_date: '2026-10-02', amount: 6068, direction: 'in', status: 'new', payment_id: null,
      inn: '7724425498', counterparty: 'ООО "ШОВЕР ГЛАСС"', purpose: 'Оплата по счет-спецификации № 05569 от 29.09.2026 г.', account: null },
    { id: 2, unit: 'ooo', external_key: 'k2', op_date: '2026-10-02', amount: 100000, direction: 'in', status: 'new', payment_id: null,
      inn: '668505859957', counterparty: 'МУХАМОРОВ ВЛАДИСЛАВ СЕРГЕЕВИЧ (ИП)', purpose: 'Авансовый платеж по договору', account: null },
    { id: 3, unit: 'ooo', external_key: 'k3', op_date: '2026-10-03', amount: 9000, direction: 'in', status: 'new', payment_id: null,
      inn: '7724425498', counterparty: 'ООО "ШОВЕР ГЛАСС"', purpose: 'оплата', account: null },
  ],
  payments, cashflow_entries: [], payment_requests: [],
})

describe('банк подтверждает ручную отметку «Оплачен»', () => {
  it('счёт, закрытый только отметкой, остаётся в подборе — с суммой отметки', async () => {
    const open = await loadOpenInvoices(svc(base()))
    expect(open).toHaveLength(1)
    expect(open[0]).toMatchObject({ no: '05569', remainder: 6068, paid: 0, marked: 6068 })
  })

  it('пришёл перевод — платёж из банка, отметка снята, деньги не задвоились', async () => {
    const db = base()
    const r = await postBankRow(svc(db), db.tables.bank_statement_rows[0] as unknown as BankRow,
      { fundId: 3, subfundId: null, account: null, requestId: null, invoiceId: 1 }, { id: 'u', name: 'Вера' })
    expect(r).toMatchObject({ ok: true, invoice: { replaced: 1, partial: false } })
    const live = db.tables.payments.filter(p => !p.voided_at)
    expect(live.map(p => [p.source, p.amount])).toEqual([['bank_statement_import', 6068]])
  })

  it('отметка «Наличные» — не перевод: банк её не заменяет, счёт оплачен', async () => {
    const open = await loadOpenInvoices(svc(base([mark({ method: 'Наличные' })])))
    expect(open).toHaveLength(0)
  })
})

describe('автопроставление при загрузке выписки', () => {
  it('уверенная строка → оплата заказа без человека; свой перевод и строка без номера не трогаются; ДДС не создаётся', async () => {
    const db = base()
    const res = await autoApplyBank(svc(db), 'ooo', 'Вера')
    expect(res.applied.map(a => [a.rowId, a.invoiceNo, a.replaced])).toEqual([[1, '05569', 1]])
    expect(res.more).toBe(false)
    const rows = db.tables.bank_statement_rows
    expect(rows[0]).toMatchObject({ status: 'new', invoice_id: 1 })
    expect(rows[0].payment_id).toBeTruthy()
    expect(rows[1].payment_id).toBeNull()
    expect(rows[2].payment_id).toBeNull()
    expect(db.tables.cashflow_entries).toHaveLength(0)
    const pay = db.tables.payments.find(p => p.id === rows[0].payment_id)!
    expect(pay).toMatchObject({ source: 'bank_statement_import', entered_by_name: null })
    expect(String(pay.note)).toContain('загрузил(а) Вера')

    // Бухгалтер проводит строку в ДДС — тот же платёж, не второй
    const r = await postBankRow(svc(db), rows[0] as unknown as BankRow,
      { fundId: 3, subfundId: null, account: null, requestId: null, invoiceId: 1 }, { id: 'u', name: 'Вера' })
    expect(r).toMatchObject({ ok: true, paymentId: pay.id })
    expect(db.tables.payments.filter(p => !p.voided_at)).toHaveLength(1)
    expect(db.tables.cashflow_entries[0]).toMatchObject({ payment_id: pay.id })
  })

  it('повторный вызов ничего не делает', async () => {
    const db = base()
    await autoApplyBank(svc(db), 'ooo', null)
    const again = await autoApplyBank(svc(db), 'ooo', null)
    expect(again.applied).toHaveLength(0)
    expect(db.tables.payments.filter(p => p.source === 'bank_statement_import')).toHaveLength(1)
  })
})
