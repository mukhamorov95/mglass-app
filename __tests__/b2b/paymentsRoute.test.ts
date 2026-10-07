import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// /api/b2b-orders/payments слал заказы одним .in('id', ids), а PostgREST отдаёт не больше
// 1000 строк: 07.10 у владельца на экране 1213 заказов, и у 213 самых новых оплата молча
// пропадала. Подделка ниже режет каждый запрос на 1000 строк так же, как прод.

type R = Record<string, unknown>
const MAX_ROWS = 1000

const db = vi.hoisted(() => ({
  tables: {} as Record<string, R[]>,
  failTable: null as string | null,
}))

vi.mock('@/lib/apiAuth', () => ({ requireRole: async () => 'admin' }))

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
const orders = (ids: number[], total = 1000) => ids.map(id => ({ id, total_after_discount: total, total_sale_inc_vat: total, archived_at: null, created_at: '2026-09-01' }))

let payId = 0
const pay = (amount: number, b2b_order_id: number | null, invoice_id: number | null = null) =>
  ({ id: ++payId, amount, b2b_order_id, invoice_id, voided_at: null })

async function call(ids: number[]) {
  const res = await GET(new NextRequest(`http://localhost/api/b2b-orders/payments?ids=${ids.join(',')}`))
  return { status: res.status, body: await res.json() as { paid?: Record<number, number>; error?: string } }
}

beforeEach(() => {
  db.tables = { b2b_orders: [], payments: [], invoices: [] }
  db.failTable = null
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
