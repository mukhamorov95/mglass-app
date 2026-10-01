import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// Точки на рынке (решение владельца 01.10.2026):
//  • признак «Точка» в /api/admin/b2b-access ставит только владелец;
//  • заказ точки не уходит в работу без 100 % оплаты — ни через «Запустить в работу»
//    (/api/b2b-quotes/[id]/notes), ни через статус воронки, ни через задачи цеху
//    (/api/b2b-orders/[id]/launch-production). Остальных партнёров правило не касается.
// Роли идут через настоящие getRole/requireOwner/canAccessRoute; подменена только база.

type Row = Record<string, unknown>
type Write = { table: string; op: 'update' | 'upsert' | 'insert'; payload: unknown; filters: [string, unknown][] }

const h = vi.hoisted(() => ({
  user: null as { id: string; email?: string } | null,
  tables: {} as Record<string, Record<string, unknown>[]>,
  writes: [] as { table: string; op: string; payload: unknown; filters: [string, unknown][] }[],
  rpc: [] as { fn: string; args: unknown }[],
}))

function fakeDb() {
  const from = (table: string) => {
    const filters: [string, unknown][] = []
    let op: 'select' | Write['op'] = 'select'
    let payload: unknown
    const rows = () => (h.tables[table] ?? []).filter(r => filters.every(([c, v]) => r[c] === v))
    const result = () => {
      if (op === 'select') return { data: rows(), error: null }
      h.writes.push({ table, op, payload, filters: [...filters] })
      return { data: rows().map(r => ({ id: r.id })), error: null }
    }
    const b: Record<string, unknown> = {}
    const self = () => b
    Object.assign(b, {
      select: self, neq: self, in: self, is: self, not: self, order: self, range: self, limit: self, gte: self,
      eq: (c: string, v: unknown) => { filters.push([c, v]); return b },
      update: (p: unknown) => { op = 'update'; payload = p; return b },
      upsert: (p: unknown) => { op = 'upsert'; payload = p; return b },
      insert: (p: unknown) => { op = 'insert'; payload = p; return b },
      maybeSingle: async () => ({ data: (result().data as Row[])[0] ?? null, error: null }),
      single: async () => {
        const d = (result().data as Row[])[0]
        return d ? { data: d, error: null } : { data: null, error: { message: 'no rows' } }
      },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej),
    })
    return b
  }
  return {
    auth: { getUser: async () => ({ data: { user: h.user }, error: null }) },
    from,
    rpc: async (fn: string, args: unknown) => { h.rpc.push({ fn, args }); return { data: null, error: null } },
  }
}

vi.mock('@/lib/supabase-server', () => ({ createClient: async () => fakeDb() }))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => fakeDb() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeDb() }))
vi.mock('@/lib/setupToken', () => ({ createSetupToken: async () => 'token' }))
vi.mock('@/lib/notify', () => ({ notifyPartnerAccessGranted: async () => false }))
vi.mock('@/lib/partnerNotify', () => ({ pushNotification: async () => {} }))

import { POST as accessPOST } from '@/app/api/admin/b2b-access/route'
import { POST as notesPOST } from '@/app/api/b2b-quotes/[id]/notes/route'
import { POST as launchPOST } from '@/app/api/b2b-orders/[id]/launch-production/route'

const req = (body: unknown) =>
  new Request('http://localhost/api', { method: 'POST', body: JSON.stringify(body) }) as unknown as NextRequest
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) })

const POINT = 501
const OTHER = 502
const ORDER = 9001

function as(role: string | null) {
  h.user = { id: 'u-test' }
  h.tables.users = role === null ? [] : [{ id: 'u-test', role, name: 'Тест', permissions: {} }]
}

function seed(clientId: number, notes: Row) {
  h.tables.b2b_clients = [{ id: POINT, is_point: true }, { id: OTHER, is_point: false }]
  h.tables.b2b_orders = [{
    id: ORDER, client_id: clientId, client_name: 'Клиент', items: [], launched_at: null,
    notes: JSON.stringify(notes), total_after_discount: 4000, total_sale_inc_vat: 4000,
  }]
}

const ordersWrites = () => h.writes.filter(w => w.table === 'b2b_orders' || w.table === 'production_tasks')

beforeEach(() => {
  h.user = null
  h.tables = {}
  h.writes = []
  h.rpc = []
})

describe('признак «Точка» ставит только владелец', () => {
  const setPoint = (value: unknown, clientId = POINT) => accessPOST(req({ action: 'set_point', clientId, value }))

  it.each(['manager', 'commercial', 'production', 'partner', 'buyer', 'cfo', 'measurer'])('%s — 403, база не тронута', async role => {
    as(role)
    h.tables.b2b_clients = [{ id: POINT, is_point: false }]
    const r = await setPoint(true)
    expect(r.status).toBe(403)
    expect(h.writes).toEqual([])
  })

  it('без входа — 403', async () => {
    h.tables.b2b_clients = [{ id: POINT, is_point: false }]
    const r = await setPoint(true)
    expect(r.status).toBe(403)
    expect(h.writes).toEqual([])
  })

  it.each(['admin', 'ceo'])('%s — ставит и снимает признак у выбранного клиента', async role => {
    as(role)
    h.tables.b2b_clients = [{ id: POINT, is_point: false }]
    const on = await setPoint(true)
    expect(on.status).toBe(200)
    expect(await on.json()).toEqual({ ok: true, value: true })
    const off = await setPoint(false)
    expect(off.status).toBe(200)
    expect(h.writes).toEqual([
      { table: 'b2b_clients', op: 'update', payload: { is_point: true }, filters: [['id', POINT]] },
      { table: 'b2b_clients', op: 'update', payload: { is_point: false }, filters: [['id', POINT]] },
    ])
  })

  it('значение не true/false — 400, ничего не пишется', async () => {
    as('admin')
    h.tables.b2b_clients = [{ id: POINT, is_point: false }]
    expect((await setPoint('yes')).status).toBe(400)
    expect(h.writes).toEqual([])
  })

  it('нет такого клиента — 404, а не «сохранено»', async () => {
    as('admin')
    h.tables.b2b_clients = []
    expect((await setPoint(true, 777)).status).toBe(404)
  })
})

describe('«Запустить в работу»: заказ точки — только после 100 % оплаты', () => {
  const launch = () => notesPOST(req({ action: 'launch', workDate: '2026-10-01' }), ctx(ORDER))
  const status = (to: string) => notesPOST(req({ action: 'status', to }), ctx(ORDER))

  it('точка без оплаты — 409 с причиной; ни запуска, ни notes', async () => {
    as('manager')
    seed(POINT, { status: 'pending_approval' })
    const r = await launch()
    expect(r.status).toBe(409)
    expect((await r.json()).error).toContain('только после 100 % оплаты')
    expect(ordersWrites()).toEqual([])
    expect(h.rpc).toEqual([])
  })

  it('точка с предоплатой — тоже 409: предоплата не полная оплата', async () => {
    as('manager')
    seed(POINT, { payment_status: 'partial', prepayment_amount: 2000 })
    const r = await launch()
    expect(r.status).toBe(409)
    expect((await r.json()).error).toContain('Отмечена предоплата')
    expect(ordersWrites()).toEqual([])
  })

  it('точка с отметкой «Оплачен» — запускается', async () => {
    as('manager')
    seed(POINT, { payment_status: 'paid' })
    const r = await launch()
    expect(r.status).toBe(200)
    const upd = ordersWrites().find(w => w.op === 'update')
    expect((upd?.payload as Row).launched_at).toBe('2026-10-01')
  })

  it('другой партнёр без оплаты — запускается, как раньше', async () => {
    as('manager')
    seed(OTHER, {})
    const r = await launch()
    expect(r.status).toBe(200)
    expect(ordersWrites().some(w => (w.payload as Row).launched_at === '2026-10-01')).toBe(true)
  })

  it('воронка: статус «в работе» у неоплаченной точки — 409, «согласовано» — можно', async () => {
    as('manager')
    seed(POINT, {})
    for (const to of ['sent', 'confirmed', 'in_production']) {
      expect((await status(to)).status).toBe(409)
    }
    expect(ordersWrites()).toEqual([])
    expect((await status('agreed')).status).toBe(200)
  })
})

describe('задачи цеху: заказ точки без оплаты в цех не попадает', () => {
  const tasks = () => launchPOST(req({}), ctx(ORDER))

  it('точка без оплаты — 409, задачи не создаются', async () => {
    as('manager')
    seed(POINT, {})
    const r = await tasks()
    expect(r.status).toBe(409)
    expect(ordersWrites()).toEqual([])
    expect(h.rpc).toEqual([])
  })

  it('другой партнёр — задачи создаются, как раньше', async () => {
    as('manager')
    seed(OTHER, {})
    const r = await tasks()
    expect(r.status).toBe(200)
  })

  it('цех и партнёр запустить не могут вовсе — 403', async () => {
    seed(OTHER, {})
    for (const role of ['production', 'partner']) {
      as(role)
      expect((await tasks()).status).toBe(403)
    }
  })
})
