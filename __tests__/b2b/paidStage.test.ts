import { describe, it, expect, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { makeDb, fakeClient, type FakeDb } from '../money/fakeSupabase'
import { paidStageChange, syncPaidStages } from '@/lib/b2b/paidStage'

// 14.10 владелец: у ShowerGlass «Оплачен · банк» стоял (деньги 09.10), а этап «Оплачен»
// жали руками и дата была 14.10. Этап ставят деньги, датой денег.

let db: FakeDb
// RPC записи notes — как в базе: плоские ключи поверх, этапы — по ключу этапа
function client() {
  const c = fakeClient(db) as unknown as { rpc: unknown }
  c.rpc = async (fn: string, a: { p_order_id: number; p_patch?: Record<string, unknown>; p_stages?: Record<string, unknown> }) => {
    const o = db.tables.b2b_orders.find(r => r.id === a.p_order_id)!
    const n = o.notes ? JSON.parse(String(o.notes)) : {}
    if (fn === 'patch_order_notes_shallow') Object.assign(n, a.p_patch)
    if (fn === 'mark_order_stages') n.stages = { ...(n.stages ?? {}), ...a.p_stages }
    o.notes = JSON.stringify(n)
    return { data: null, error: null }
  }
  return c as unknown as SupabaseClient
}
const notes = (id: number) => JSON.parse(String(db.tables.b2b_orders.find(r => r.id === id)!.notes ?? '{}'))
const order = (id: number, total: number, n: unknown = null) =>
  ({ id, total_after_discount: total, total_sale_inc_vat: total, notes: n ? JSON.stringify(n) : null })
const bank = (id: number, o: Record<string, unknown>) =>
  ({ id, voided_at: null, source: 'bank_statement_import', method: 'Перевод', external_key: `bank:ooo:${id}`, invoice_id: null, b2b_order_id: null, ...o })

beforeEach(() => {
  db = makeDb({
    b2b_orders: [
      order(5641, 100823, { payment_status: 'paid', stages: { invoice_paid: '2026-10-14', cut: '2026-10-06' } }),
      order(5672, 6327),
      order(5167, 4802), order(5400, 9789),
      order(5500, 20000),
      order(5600, 15000, { payment_status: 'paid', stages: { invoice_paid: '2026-10-01' } }),
    ],
    invoices: [{ id: 60, order_ids: ['5167', '5400'], amount: 14591, status: 'paid' }],
    payments: [
      bank(1, { amount: 100823, b2b_order_id: 5641, paid_at: '2026-10-09' }),
      bank(2, { amount: 14591, invoice_id: 60, paid_at: '2026-09-24' }),
      bank(3, { amount: 5000, b2b_order_id: 5500, paid_at: '2026-10-02' }),
      // «Оплачен» менеджера наличными — не банк, этап не трогаем
      { id: 4, amount: 15000, b2b_order_id: 5600, invoice_id: null, voided_at: null, source: 'b2b_order', method: 'Наличные', external_key: 'b2b:5600:settlement', paid_at: '2026-10-01' },
    ],
  })
})

describe('этап «Оплачен» по деньгам', () => {
  it('дата этапа — дата денег из выписки, остальные этапы целы; без денег и частично — не трогаем', async () => {
    const res = await syncPaidStages(client())
    expect(res.changed).toEqual(expect.arrayContaining([
      { orderId: 5641, from: '2026-10-14', to: '2026-10-09' },
      { orderId: 5167, from: null, to: '2026-09-24' },
      { orderId: 5400, from: null, to: '2026-09-24' },
    ]))
    expect(res.changed).toHaveLength(3)
    expect(notes(5641)).toMatchObject({ payment_status: 'paid', payment_source: 'bank', stages: { invoice_paid: '2026-10-09', cut: '2026-10-06' } })
    expect(notes(5672)).toEqual({})
    expect(notes(5500)).toEqual({})
    expect(notes(5600)).toEqual({ payment_status: 'paid', stages: { invoice_paid: '2026-10-01' } })

    expect((await syncPaidStages(client())).changed).toEqual([])
  })

  it('платёж из выписки сняли — этап, поставленный деньгами, снимается; поставленный человеком — нет', async () => {
    await syncPaidStages(client())
    db.tables.payments.find(p => p.id === 1)!.voided_at = '2026-10-15T10:00:00Z'
    db.tables.payments.find(p => p.id === 4)!.voided_at = '2026-10-15T10:00:00Z'
    const res = await syncPaidStages(client())
    expect(res.changed).toEqual([{ orderId: 5641, from: '2026-10-09', to: null }])
    expect(notes(5641).stages).toEqual({ invoice_paid: null, cut: '2026-10-06' })
    expect(notes(5600).stages.invoice_paid).toBe('2026-10-01')
  })

  it('перевод половины, остаток наличными — этап датой наличных; отметка переводом даты не даёт', async () => {
    db.tables.b2b_orders.push(order(5800, 20000))
    db.tables.payments.push(
      bank(10, { amount: 10000, b2b_order_id: 5800, paid_at: '2026-10-01' }),
      { id: 11, amount: 10000, b2b_order_id: 5800, invoice_id: null, voided_at: null, source: 'b2b_order', method: 'Наличные', external_key: 'b2b:5800:remainder', paid_at: '2026-10-10' },
      { id: 12, amount: 20000, b2b_order_id: 5800, invoice_id: null, voided_at: null, source: 'b2b_order', method: 'Счёт', external_key: 'b2b:5800:settlement', paid_at: '2026-10-12' },
    )
    await syncPaidStages(client())
    expect(notes(5800)).toMatchObject({ payment_source: 'bank', stages: { invoice_paid: '2026-10-10' } })
  })

  it('paidStageChange: аванс помечается своим источником', () => {
    expect(paidStageChange({}, { total: 100, paid: 100, date: '2026-10-07', source: 'advance' }))
      .toEqual({ stage: '2026-10-07', status: 'paid', source: 'advance' })
    expect(paidStageChange({}, { total: 100, paid: 99.5, date: '2026-10-07', source: 'bank' })).not.toBeNull()
    expect(paidStageChange({}, { total: 100, paid: 50, date: '2026-10-07', source: 'bank' })).toBeNull()
  })
})
