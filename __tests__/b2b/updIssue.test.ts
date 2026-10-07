import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const log = vi.fn(async () => {})
vi.mock('@/lib/activityLog', () => ({ writeLogForCurrentUser: (...a: unknown[]) => log(...(a as [])) }))

import { issueUpdForOrder, parseEntityId, type UpdOrder } from '@/lib/b2b/updIssue'
import { moscowDate } from '@/lib/b2b/updView'

type Rows = Record<string, unknown>
type Rpc = (name: string, args: Record<string, unknown>) => { data: unknown; error: { code?: string; message: string } | null }

// Одна строка на таблицу — этого хватает: выдача читает по одной записи из каждой.
function fakeSvc(rows: Rows, rpc: Rpc) {
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const from = (table: string) => {
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'order', 'limit', 'contains']) q[m] = () => q
    q.maybeSingle = async () => ({ data: rows[table] ?? null, error: null })
    return q
  }
  const svc = {
    from,
    rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return rpc(name, args) },
  } as unknown as SupabaseClient
  return { svc, calls }
}

const order: UpdOrder = {
  id: 5600, custom_number: '05600', client_id: 10, client_name: 'Ромашка',
  discount_percent: 0, notes: null, created_at: '2026-01-05T10:00:00Z',
  total_sale_inc_vat: 12_200, total_after_discount: 12_200,
  items: [{ materialName: 'Зеркало', thickness: 4, quantity: 2, saleIncVat: 12_200 }],
}
const entity = { client_id: 10, active: true, full_name: 'ООО «Ромашка»', inn: '7700000000', kpp: '770001001', legal_address: 'Москва' }
const base: Rows = {
  upd_registry: null,
  b2b_orders: { launched_at: '2026-01-06T10:00:00Z', archived_at: null },
  b2b_client_legal_entities: entity,
  b2b_clients: { name: 'Ромашка', inn: '', kpp: '' },
  users: { name: 'Алёна' },
}
const issuedRow = (args: Record<string, unknown>) => ({
  year: 2026, number: 533, doc_date: args.p_doc_date, snapshot: args.p_snapshot,
  issued_at: '2026-10-08T09:00:00Z', issued_by_name: args.p_by_name,
})
const okRpc: Rpc = (_n, args) => ({ data: [issuedRow(args)], error: null })
const user = { id: 'u1', email: 'acc@mglass.ru' }
const today = moscowDate()

beforeEach(() => log.mockClear())

describe('выдача УПД — общая для менеджера и бухгалтера', () => {
  it('документ собирает сервер: покупатель из юрлица клиента, суммы из заказа; запись в журнал', async () => {
    const { svc, calls } = fakeSvc(base, okRpc)
    const out = await issueUpdForOrder(svc, order, { docDate: today, entityId: 7 }, user)
    expect(out.status).toBe(200)
    expect(out.json.already).toBe(false)
    const args = calls[0].args
    expect(calls[0].name).toBe('issue_upd')
    expect(args.p_buyer_inn).toBe('7700000000')
    expect(args.p_buyer_name).toBe('ООО «Ромашка»')
    expect(args.p_sum_inc_vat).toBe(12_200)
    expect(args.p_by_name).toBe('Алёна')
    expect(log).toHaveBeenCalledTimes(1)
  })

  it('уже выдан — тот же документ, без второго номера', async () => {
    const { svc, calls } = fakeSvc({ ...base, upd_registry: { year: 2026, number: 533 } }, okRpc)
    const out = await issueUpdForOrder(svc, order, { docDate: today, entityId: 7 }, user)
    expect(out).toMatchObject({ status: 200, json: { already: true } })
    expect(calls).toHaveLength(0)
  })

  it('дата раньше заказа — 400', async () => {
    const { svc } = fakeSvc(base, okRpc)
    expect((await issueUpdForOrder(svc, order, { docDate: '2025-12-31', entityId: 7 }, user)).status).toBe(400)
  })

  it('просчёт и архив — 409', async () => {
    const draft = fakeSvc({ ...base, b2b_orders: { launched_at: null, archived_at: null } }, okRpc)
    expect((await issueUpdForOrder(draft.svc, order, { docDate: today, entityId: 7 }, user)).status).toBe(409)
    const arch = fakeSvc({ ...base, b2b_orders: { launched_at: '2026-01-06', archived_at: '2026-02-01' } }, okRpc)
    const out = await issueUpdForOrder(arch.svc, order, { docDate: today, entityId: 7 }, user)
    expect(out.status).toBe(409)
    expect(String(out.json.error)).toMatch(/архив/)
  })

  it('юрлицо чужого клиента — 404, документ не выдан', async () => {
    const { svc, calls } = fakeSvc({ ...base, b2b_client_legal_entities: { ...entity, client_id: 99 } }, okRpc)
    expect((await issueUpdForOrder(svc, order, { docDate: today, entityId: 7 }, user)).status).toBe(404)
    expect(calls).toHaveLength(0)
  })

  it('без ИНН покупателя — 400', async () => {
    const { svc, calls } = fakeSvc(base, okRpc)
    const out = await issueUpdForOrder(svc, order, { docDate: today, entityId: null }, user)
    expect(out.status).toBe(400)
    expect(String(out.json.error)).toMatch(/ИНН/)
    expect(calls).toHaveLength(0)
  })

  it('серия на год не задана — 409 с подсказкой, журнал не пишется', async () => {
    const { svc } = fakeSvc(base, () => ({ data: null, error: { code: 'P0001', message: 'upd_series_not_set:2026' } }))
    const out = await issueUpdForOrder(svc, order, { docDate: today, entityId: 7 }, user)
    expect(out).toMatchObject({ status: 409, json: { code: 'series_not_set' } })
    expect(log).not.toHaveBeenCalled()
  })

  it('entity_id из запроса', () => {
    expect(parseEntityId(null)).toBeNull()
    expect(parseEntityId('')).toBeNull()
    expect(parseEntityId('7')).toBe(7)
    expect(Number.isNaN(parseEntityId('x'))).toBe(true)
  })
})
