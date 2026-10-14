import { describe, it, expect, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { makeDb, fakeClient, type FakeDb } from './fakeSupabase'
import { advanceKey, allocateAdvances, createAdvance, loadAdvanceSummaries, planAllocations, voidAdvance } from '@/lib/accounting/clientAdvance'
import { autoApplyBank } from '@/lib/accounting/bankAuto'
import { paidByOf } from '@/lib/b2b/paidBy'

// 14.10, ГлассДекор: 400 000 ₽ пришли авансом (в назначении — счёт 05522 на 27 500),
// запускаемые заказы списываются с него. 05522 оплачен 27 250 отдельным платежом — 250 ₽
// доплачиваются с аванса.

let db: FakeDb
const svc = () => fakeClient(db) as unknown as SupabaseClient
const me = { id: 'u-1', name: 'Владислав' }
const order = (id: number, total: number, launched: string | null, notes: unknown = null) =>
  ({ id, client_id: 7, client_name: 'ГлассДекор', total_after_discount: total, total_sale_inc_vat: total, launched_at: launched, archived_at: null, notes })
const live = () => db.tables.payments.filter(p => !p.voided_at)
const alloc = (orderId: number) => live().find(p => p.external_key === advanceKey(1, orderId))?.amount ?? null

beforeEach(() => {
  db = makeDb({
    b2b_clients: [{ id: 7, name: 'ГлассДекор', inn: '7723428778' }],
    b2b_orders: [
      order(5448, 51368, '2026-09-10'),
      order(5522, 27500, '2026-09-23'),
      order(5597, 108500, '2026-10-07'),
      order(5643, 25227, '2026-10-07'),
      order(5689, 47177, '2026-10-12'),
      order(5700, 10000, '2026-10-13', JSON.stringify({ status: 'cancelled' })),
      order(5701, 9000, null),
    ],
    invoices: [
      { id: 50, invoice_no: '05448', order_ids: ['5448'], amount: 51368, status: 'paid' },
      { id: 72, invoice_no: '05522', order_ids: ['5522'], amount: 27500, status: 'issued' },
      { id: 90, invoice_no: '05597', order_ids: ['5597'], amount: 108500, status: 'issued' },
    ],
    payments: [
      { id: 1, external_key: 'bank:ooo:a', amount: 51368, invoice_id: 50, b2b_order_id: 5448, source: 'bank_statement_import', method: 'Перевод', voided_at: null, paid_at: '2026-09-10' },
      { id: 2, external_key: 'bank:ooo:b', amount: 27250, invoice_id: 72, b2b_order_id: 5522, source: 'bank_statement_import', method: 'Перевод', voided_at: null, paid_at: '2026-09-23' },
      // менеджер отметил «Оплачен» — до того, как деньги разнесли
      { id: 3, external_key: 'b2b:5597:settlement', amount: 108500, invoice_id: null, b2b_order_id: 5597, source: 'b2b_order', method: 'Счёт', voided_at: null, paid_at: '2026-10-07' },
    ],
    bank_statement_rows: [
      { id: 108, unit: 'ooo', external_key: 'adv', op_date: '2026-09-30', amount: 400000, direction: 'in', status: 'new', inn: '7723428778', payment_id: null, counterparty: 'ООО «ТПК «ГЛАСС ДЕКОР»', purpose: 'СЧЕТ-СПЕЦИФИКАЦИЯ №05522 ОТ 23.09.2026', account: null },
    ],
    client_advances: [],
  })
})

describe('planAllocations', () => {
  const adv = { id: 1, client_id: 7, amount: 100, received_at: '2026-09-30', applies_from: '2026-09-23' }
  it('по порядку запуска, заказы до даты аванса не трогает, последний — частично', () => {
    const plan = planAllocations([adv], [
      { id: 3, launched: '2026-10-07', total: 80, paid: 0 },
      { id: 1, launched: '2026-09-01', total: 50, paid: 0 },
      { id: 2, launched: '2026-09-23', total: 30, paid: 0 },
    ])
    expect([...plan]).toEqual([[advanceKey(1, 2), 30], [advanceKey(1, 3), 70]])
  })
  it('второй аванс начинает с того, что не покрыл первый', () => {
    const plan = planAllocations([{ ...adv, id: 2, received_at: '2026-10-05' }, adv], [{ id: 3, launched: '2026-10-07', total: 150, paid: 20 }])
    expect([...plan]).toEqual([[advanceKey(1, 3), 100], [advanceKey(2, 3), 30]])
  })
})

describe('аванс ГлассДекор', () => {
  it('строка выписки → аванс: доплата 05522 и три запущенных заказа; отменённый и непущенный не трогает', async () => {
    const res = await createAdvance(svc(), db.tables.bank_statement_rows[0] as never, { appliesFrom: '2026-09-23', me })
    expect(res).toMatchObject({ ok: true, allocated: { written: 4, voided: 0, marksReplaced: 1 } })
    expect(db.tables.client_advances[0]).toMatchObject({ client_id: 7, amount: 400000, received_at: '2026-09-30', applies_from: '2026-09-23' })
    expect([5448, 5522, 5597, 5643, 5689, 5700, 5701].map(alloc)).toEqual([null, 250, 108500, 25227, 47177, null, null])
    // отметка менеджера заменена деньгами аванса — второй раз заказ не оплачен
    expect(db.tables.payments.find(p => p.external_key === 'b2b:5597:settlement')!.voided_at).toBeTruthy()
    expect(live().find(p => p.external_key === advanceKey(1, 5597))).toMatchObject({ invoice_id: 90, source: 'client_advance', paid_at: '2026-10-07' })
    expect(live().find(p => p.external_key === advanceKey(1, 5522))).toMatchObject({ paid_at: '2026-09-30', kind: 'remainder' })
    expect(db.tables.invoices.find(i => i.id === 72)).toMatchObject({ status: 'paid' })

    const sum = (await loadAdvanceSummaries(svc(), [108])).get(108)!
    expect(sum).toMatchObject({ client: 'ГлассДекор', amount: 400000, used: 181154, left: 218846 })
    expect(sum.orders.map(o => o.no)).toEqual(['05522', '05597', '05643', '05689'])
  })

  it('повторный прогон ничего не пишет; правка итога и прямая оплата возвращают деньги в аванс', async () => {
    await createAdvance(svc(), db.tables.bank_statement_rows[0] as never, { appliesFrom: '2026-09-23', me })
    expect(await allocateAdvances(svc())).toMatchObject({ written: 0, voided: 0 })

    db.tables.b2b_orders.find(o => o.id === 5689)!.total_after_discount = 40000
    db.tables.payments.push({ id: 99, external_key: 'bank:ooo:c', amount: 25227, invoice_id: null, b2b_order_id: 5643, source: 'bank_statement_import', method: 'Перевод', voided_at: null, paid_at: '2026-10-08' })
    expect(await allocateAdvances(svc())).toMatchObject({ written: 1, voided: 1 })
    expect(alloc(5689)).toBe(40000)
    expect(alloc(5643)).toBeNull()
    expect((await loadAdvanceSummaries(svc(), [108])).get(108)!.left).toBe(400000 - 250 - 108500 - 40000)
  })

  it('отмена аванса снимает списания, счёт снова частично оплачен', async () => {
    await createAdvance(svc(), db.tables.bank_statement_rows[0] as never, { appliesFrom: '2026-09-23', me })
    expect(await voidAdvance(svc(), 1, me)).toEqual({ ok: true, voided: 4 })
    expect(live().filter(p => p.source === 'client_advance')).toEqual([])
    expect(db.tables.invoices.find(i => i.id === 72)!.status).not.toBe('paid')
  })

  it('клиент по ИНН не найден — отказ словами, аванс не записан', async () => {
    db.tables.bank_statement_rows[0].inn = '0000000000'
    expect(await createAdvance(svc(), db.tables.bank_statement_rows[0] as never, { me })).toMatchObject({ ok: false, status: 404 })
    expect(db.tables.client_advances).toEqual([])
  })

  it('строку-аванс автоподбор по счёту не проставляет', async () => {
    const row = db.tables.bank_statement_rows[0]
    row.amount = 250   // сумма = остаток счёта 05522, номер в назначении — без аванса подобралось бы
    db.tables.client_advances.push({ id: 1, client_id: 7, unit: 'ooo', bank_row_id: 108, amount: 250, received_at: '2026-09-30', applies_from: '2026-10-20', voided_at: null })
    const res = await autoApplyBank(svc(), 'ooo', null)
    expect(res.applied).toEqual([])
  })

  it('метка в заказах — «Оплачен · аванс»', () => {
    expect(paidByOf({ id: 1, source: 'client_advance', entered_by_name: null, paid_at: '2026-10-07' }))
      .toEqual({ label: 'аванс', title: 'Списано с аванса клиента 07.10.2026' })
  })
})
