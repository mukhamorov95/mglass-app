import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { issueUpd, loadUpdIssued, loadUpdSeries } from '@/lib/b2b/updRegistry'
import { buildUpdBody } from '@/lib/b2b/updView'
import { documentSafeNotes, documentSafeItems } from '@/lib/b2b/publicQuote'
import type { InvoiceOrder, InvoiceRequisites } from '@/lib/b2b/invoiceMath'

type Res = { data: unknown; error: { code?: string; message: string } | null }
const sbWith = (res: Res) => ({
  rpc: async () => res,
  from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => res }), order: async () => res }),
  }),
}) as unknown as SupabaseClient

const order: InvoiceOrder = {
  id: 5544, custom_number: '05544', discount_percent: 0, notes: null, created_at: '2026-09-25T10:00:00Z',
  total_sale_inc_vat: 12_200, total_after_discount: 12_200,
  items: [{ materialName: 'Зеркало', thickness: 4, quantity: 2, saleIncVat: 12_200 }],
}
const req = { full_name: 'ООО «Ромашка»', inn: '7700000000', kpp: '770001001', legal_address: 'Москва' } as InvoiceRequisites
const body = buildUpdBody(order, req, 'Ромашка', '2026-10-07')
const by = { id: 'u', name: 'Яна' }

describe('реестр УПД', () => {
  it('до SQL владельца — не выдан, серий нет, ошибки нет', async () => {
    const missing = { data: null, error: { code: '42P01', message: 'relation "upd_registry" does not exist' } }
    expect(await loadUpdIssued(sbWith(missing), 1)).toBeNull()
    expect(await loadUpdSeries(sbWith({ data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.upd_series'" } }))).toBeNull()
    expect(await issueUpd(sbWith({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }), { orderId: 1, docDate: '2026-10-07', entityId: null, body, by }))
      .toEqual({ ok: false, code: 'pending_sql' })
  })

  it('серия не задана бухгалтером — номер не выдаётся, год назван', async () => {
    const res = { data: null, error: { code: 'P0001', message: 'upd_series_not_set:2026' } }
    expect(await issueUpd(sbWith(res), { orderId: 1, docDate: '2026-10-07', entityId: null, body, by }))
      .toEqual({ ok: false, code: 'series_not_set', year: 2026 })
  })

  it('выданный — первая строка ответа функции, со снимком', async () => {
    const row = { id: 9, year: 2026, number: 533, doc_date: '2026-10-07', snapshot: body, issued_at: '2026-10-07T09:00:00Z', issued_by_name: 'Яна', buyer_inn: '7700000000' }
    const out = await issueUpd(sbWith({ data: [row], error: null }), { orderId: 1, docDate: '2026-10-07', entityId: 3, body, by })
    expect(out).toEqual({ ok: true, issued: { year: 2026, number: 533, doc_date: '2026-10-07', snapshot: body, issued_at: '2026-10-07T09:00:00Z', issued_by_name: 'Яна' } })
  })

  it('прочая ошибка базы не глотается', async () => {
    await expect(loadUpdIssued(sbWith({ data: null, error: { code: '57014', message: 'timeout' } }), 1)).rejects.toThrow('timeout')
    await expect(issueUpd(sbWith({ data: null, error: { code: '23505', message: 'duplicate key' } }), { orderId: 1, docDate: '2026-10-07', entityId: null, body, by })).rejects.toThrow('duplicate')
  })
})

describe('документ партнёра: дата УПД та же, что у менеджера', () => {
  it('отметка «Отгружен» уходит датой, сами этапы — нет', () => {
    const out = JSON.parse(documentSafeNotes(JSON.stringify({ launched_at: '2026-09-17', stages: { shipped: '2026-10-05', cut: '2026-09-20' } }))!)
    expect(out).toEqual({ launched_at: '2026-09-17', shipped_date: '2026-10-05' })
  })
  it('признак цены из прайса клиента доходит до счёта партнёра', () => {
    expect(documentSafeItems([{ saleIncVat: 100, clientPriced: true }])[0].clientPriced).toBe(true)
  })
})
