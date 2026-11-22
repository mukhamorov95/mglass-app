import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// /api/b2b-orders/payments слал заказы одним .in('id', ids), а PostgREST отдаёт не больше
// 1000 строк: 07.10 у владельца на экране 1213 заказов, и у 213 самых новых оплата молча
// пропадала. Подделка ниже режет каждый запрос на 1000 строк так же, как прод.
// До 22.11 маршрут пускал любую роль из списка ко всем заказам: менеджер без «Все» получал оплату
// чужих, хотя RLS payments ему B2B-платежи не отдаёт. Ворота здесь настоящие — подменены сессия и профиль.

type R = Record<string, unknown>
const MAX_ROWS = 1000

const db = vi.hoisted(() => ({
  tables: {} as Record<string, R[]>,
  failTable: null as string | null,
  role: 'admin',
  uid: 'owner',
}))

vi.mock('@/lib/getRole', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/getRole')>()),
  getRole: async () => db.role,
  getSessionUser: async () => ({ id: db.uid }),
  getUserProfile: async () => ({ role: db.role, permissions: {} }),
}))

vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      const preds: ((r: R) => boolean)[] = []
      let orderKey: string | null = null
      let limitN = Infinity
      const run = async (from: number, to: number) => {
        if (db.failTable === table) return { data: null, error: { message: `${table}: timeout` } }
        let rows = (db.tables[table] ?? []).filter(r => preds.every(p => p(r)))
        if (orderKey) { const k = orderKey; rows = [...rows].sort((a, b) => Number(a[k]) - Number(b[k])) }
        return { data: rows.slice(from, Math.min(to + 1, from + MAX_ROWS, limitN)), error: null }
      }
      const b = {
        select: () => b,
        in: (col: string, vals: unknown[]) => { const s = new Set(vals.map(Number)); preds.push(r => s.has(Number(r[col]))); return b },
        is: (col: string, v: unknown) => { preds.push(r => (r[col] ?? null) === v); return b },
        eq: (col: string, v: unknown) => { preds.push(r => String(r[col]) === String(v)); return b },
        maybeSingle: async () => {
          const { data, error } = await run(0, MAX_ROWS - 1)
          return { data: data?.[0] ?? null, error }
        },
        gte: (col: string, v: string) => { preds.push(r => String(r[col]) >= v); return b },
        overlaps: (col: string, vals: unknown[]) => {
          const s = new Set(vals.map(Number))
          preds.push(r => Array.isArray(r[col]) && (r[col] as unknown[]).some(x => s.has(Number(x))))
          return b
        },
        order: (col: string) => { orderKey = col; return b },
        limit: (k: number) => { limitN = k; return b },
        range: (from: number, to: number) => run(from, to),
        then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => run(0, MAX_ROWS - 1).then(ok, fail),
      }
      return b
    },
  }),
}))

import { GET } from '@/app/api/b2b-orders/payments/route'

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)
const orders = (ids: number[], total = 1000, created_by: string | null = 'owner') =>
  ids.map(id => ({ id, total_after_discount: total, total_sale_inc_vat: total, archived_at: null, created_at: '2026-09-01', created_by }))

let payId = 0
const pay = (amount: number, b2b_order_id: number | null, invoice_id: number | null = null) =>
  ({ id: ++payId, amount, b2b_order_id, invoice_id, voided_at: null, entered_by_name: 'Вера', paid_at: '2026-11-20' })

type Body = { paid?: Record<number, number>; by?: Record<number, unknown>; error?: string }
async function call(ids: number[] | null) {
  const qs = ids ? `?ids=${ids.join(',')}` : ''
  const res = await GET(new NextRequest(`http://localhost/api/b2b-orders/payments${qs}`))
  return { status: res.status, body: await res.json() as Body }
}

function as(role: string, uid: string, seeAll = false) {
  db.role = role
  db.uid = uid
  db.tables.users = [{ id: uid, see_all_orders: seeAll }]
}

beforeEach(() => {
  db.tables = { b2b_orders: [], payments: [], invoices: [], users: [] }
  db.failTable = null
  db.role = 'admin'
  db.uid = 'owner'
  payId = 0
})

describe('оплаты по заказам — больше 1000 на экране', () => {
  it('1213 заказов: оплата есть у всех, включая самые новые', async () => {
    const ids = range(1, 1213)
    db.tables.b2b_orders = orders(ids)
    db.tables.payments = ids.map(id => pay(100, id))
    const { status, body } = await call([...ids].reverse())
    expect(status).toBe(200)
    expect(Object.keys(body.paid!)).toHaveLength(1213)
    expect(body.paid![1213]).toBe(100)
  })

  it('платежей на одну пачку больше 1000 — дочитываются страницами', async () => {
    const ids = range(1, 500)
    db.tables.b2b_orders = orders(ids)
    db.tables.payments = ids.flatMap(id => [pay(100, id), pay(100, id), pay(100, id)])
    const { body } = await call(ids)
    expect(Object.values(body.paid!).every(v => v === 300)).toBe(true)
    expect(Object.keys(body.paid!)).toHaveLength(500)
  })

  it('счёт на заказы из разных пачек: оплата раскладывается один раз', async () => {
    const ids = range(1, 1213)
    db.tables.b2b_orders = orders(ids)
    db.tables.invoices = range(1, 600).map(i => ({ id: i, order_ids: [i, i + 600], amount: 2000 }))
    db.tables.payments = range(1, 600).map(i => pay(2000, null, i))
    const { body } = await call(ids)
    const paid = body.paid!
    expect(paid[1]).toBe(1000)
    expect(paid[1200]).toBe(1000)
    expect(Object.values(paid).reduce((s, v) => s + v, 0)).toBe(600 * 2000)
  })

  it('платёж с прямой привязкой не считается второй раз через счёт', async () => {
    db.tables.b2b_orders = orders([1, 2])
    db.tables.invoices = [{ id: 9, order_ids: [1, 2], amount: 2000 }]
    db.tables.payments = [pay(500, 1, 9)]
    const { body } = await call([1, 2])
    expect(body.paid).toEqual({ 1: 500 })
  })

  it('ошибка базы — 500 с причиной, а не урезанный ответ', async () => {
    db.tables.b2b_orders = orders([1])
    db.tables.payments = [pay(100, 1)]
    db.failTable = 'payments'
    const { status, body } = await call([1])
    expect(status).toBe(500)
    expect(body.error).toMatch(/payments/)
  })
})

describe('оплаты по заказам — кто что видит', () => {
  // Заказ 1 — менеджера Яны, 2 — Алины, 3 — старый без автора.
  function seed() {
    db.tables.b2b_orders = [...orders([1], 1000, 'yana'), ...orders([2], 1000, 'alina'), ...orders([3], 1000, null)]
    db.tables.payments = [pay(100, 1), pay(200, 2), pay(300, 3)]
  }

  it('менеджер без «Все» получает оплату только своих заказов — и сумму, и «кто отметил»', async () => {
    seed()
    as('manager', 'yana')
    const { status, body } = await call([1, 2, 3])
    expect(status).toBe(200)
    expect(body.paid).toEqual({ 1: 100 })
    expect(Object.keys(body.by!)).toEqual(['1'])
  })

  it('менеджер с «Все», закупщик и владелец видят все заказы', async () => {
    for (const [role, seeAll] of [['manager', true], ['buyer', false], ['admin', false], ['ceo', false]] as const) {
      seed()
      as(role, 'yana', seeAll)
      const { body } = await call([1, 2, 3])
      expect(body.paid, role).toEqual({ 1: 100, 2: 200, 3: 300 })
    }
  })

  it('сводный счёт на свой и чужой заказ: своя доля — от обоих итогов, чужой в ответе нет', async () => {
    db.tables.b2b_orders = [...orders([1], 1000, 'yana'), ...orders([2], 3000, 'alina')]
    db.tables.invoices = [{ id: 9, order_ids: [1, 2], amount: 4000 }]
    db.tables.payments = [pay(4000, null, 9)]
    as('manager', 'yana')
    const { body } = await call([1, 2])
    expect(body.paid).toEqual({ 1: 1000 })
    expect(Object.keys(body.by!)).toEqual(['1'])
  })

  it('без ids (свежий срез) менеджер тоже получает только свои', async () => {
    seed()
    as('manager', 'alina')
    const { body } = await call(null)
    expect(body.paid).toEqual({ 2: 200 })
  })

  it('роли без экрана списка и отчёта — 403; логист открывает список и видит только свои', async () => {
    seed()
    for (const role of ['commercial', 'cfo', 'production', 'accountant', 'partner']) {
      as(role, 'yana')
      expect((await call([1, 2, 3])).status, role).toBe(403)
    }
    as('logist', 'yana')
    const { status, body } = await call([1, 2, 3])
    expect(status).toBe(200)
    expect(body.paid).toEqual({ 1: 100 })
  })

  it('профиль менеджера не прочитался — 500, а не догадка о праве', async () => {
    seed()
    as('manager', 'yana')
    db.failTable = 'users'
    const { status, body } = await call([1, 2, 3])
    expect(status).toBe(500)
    expect(body.error).toMatch(/профиль/)
  })
})
