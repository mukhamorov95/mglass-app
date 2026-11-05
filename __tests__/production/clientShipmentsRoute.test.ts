import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Маршрут отгрузок целиком, на базе в памяти: отправка, частичная отгрузка, откат и возврат
// прежней отметки. Прод здесь не участвует.

type Row = Record<string, unknown>
const h = vi.hoisted(() => ({
  db: {} as Record<string, Record<string, unknown>[]>,
  canMoney: true,
  closed: [] as number[],
  reopened: [] as number[],
  role: 'admin',
  packCalls: [] as Record<string, unknown>[],
  packUpdated: 1,
}))

function query(table: string) {
  let op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select'
  let payload: Row | Row[] | null = null
  let one = false, slice: [number, number] | null = null
  const filters: ((r: Row) => boolean)[] = []
  const rows = () => (h.db[table] ??= [])
  const run = () => {
    const match = (r: Row) => filters.every(f => f(r))
    let out: Row[]
    if (op === 'insert') {
      out = (Array.isArray(payload) ? payload : [payload as Row]).map(p => ({
        ...(table === 'delivery_shipments' ? { id: rows().length + 100 + Math.floor(Math.random() * 1e6), shipped_at: null, total_weight_kg: null, created_at: 'x' } : {}), ...p,
      }))
      rows().push(...out)
    } else if (op === 'upsert') {
      out = []
      for (const p of payload as Row[]) {
        const hit = rows().find(r => r.shipment_id === p.shipment_id && r.order_id === p.order_id && r.line_key === p.line_key)
        if (hit) Object.assign(hit, p); else rows().push({ ...p })
        out.push(p)
      }
    } else if (op === 'update') {
      out = rows().filter(match)
      for (const r of out) Object.assign(r, payload)
    } else if (op === 'delete') {
      out = rows().filter(match)
      h.db[table] = rows().filter(r => !match(r))
      if (table === 'delivery_shipments') h.db.delivery_shipment_items = (h.db.delivery_shipment_items ?? []).filter(i => !out.some(s => s.id === i.shipment_id))
    } else {
      out = rows().filter(match)
    }
    if (slice) out = out.slice(slice[0], slice[1] + 1)
    return { data: one ? out[0] ?? null : out.map(r => ({ ...r })), error: null }
  }
  const q = {
    select: () => q,
    insert: (p: Row | Row[]) => { op = 'insert'; payload = p; return q },
    update: (p: Row) => { op = 'update'; payload = p; return q },
    upsert: (p: Row[]) => { op = 'upsert'; payload = p; return q },
    delete: () => { op = 'delete'; return q },
    eq: (c: string, v: unknown) => { filters.push(r => r[c] === v); return q },
    in: (c: string, v: unknown[]) => { filters.push(r => v.includes(r[c])); return q },
    is: (c: string, v: unknown) => { filters.push(r => (r[c] ?? null) === v); return q },
    order: () => q,
    range: (a: number, b: number) => { slice = [a, b]; return q },
    maybeSingle: () => { one = true; return q },
    single: () => { one = true; return q },
    then: (ok: (v: ReturnType<typeof run>) => unknown) => Promise.resolve(run()).then(ok),
  }
  return q
}

function rpc(name: string, args: { p_order_id: number; p_stages?: Row; p_patch?: Row }) {
  const o = h.db.b2b_orders.find(r => r.id === args.p_order_id) as Row
  const notes = JSON.parse(String(o.notes ?? '{}')) as { stages?: Row } & Row
  if (name === 'mark_order_stages') notes.stages = { ...notes.stages, ...args.p_stages }
  if (name === 'patch_order_notes_shallow') Object.assign(notes, args.p_patch)
  o.notes = JSON.stringify(notes)
  return Promise.resolve({ error: null })
}

vi.mock('server-only', () => ({}))
vi.mock('@/lib/apiAuth', () => ({ requirePageAccess: async () => h.role }))
vi.mock('@/lib/production/syncStages', () => ({
  applyStageUpdates: async (_s: unknown, orderId: number, updates: Row[]) => {
    h.packCalls.push({ orderId, ...updates[0] })
    return { updated: h.packUpdated, failed: [], cascaded: [], reopened: updates[0].action === 'unset' ? [{ item_index: updates[0].item_index, stages: ['cutting', 'custom'] }] : [] }
  },
}))
vi.mock('@/lib/getRole', () => ({
  getSessionUser: async () => ({ id: 'u1', email: 'x@test' }),
  getUserProfile: async () => ({ canViewMoney: h.canMoney }),
}))
vi.mock('@/lib/serviceAs', () => ({ serviceAsMe: async () => ({ from: query, rpc }) }))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => ({ from: query, rpc }) }))
vi.mock('@/lib/production/closeOnOrderMark', () => ({
  closeOpenTasksOnOrderMark: async (_s: unknown, id: number) => { h.closed.push(id); return { closed: 1 } },
  reopenTasksOnOrderUnmark: async (_s: unknown, id: number) => { h.reopened.push(id); return { reopened: 1 } },
}))

import { GET, POST } from '@/app/api/production/client-shipments/route'
import { mskDayKey } from '@/lib/time'

const today = mskDayKey()
const call = async (body: Row) => {
  const r = await POST(new NextRequest('http://t/api', { method: 'POST', body: JSON.stringify(body) }))
  return { status: r.status, body: await r.json() as Row & { id: number; error: string; shipped_orders: number[]; reverted_orders: number[] } }
}
const order = (id: number, stages: Row = {}, clientId = 2) => ({
  id, custom_number: `0${id}`, client_id: clientId, archived_at: null, created_at: '2026-10-01T10:00:00Z',
  discount_percent: 0, total_sale_inc_vat: 1000, total_after_discount: 1000, notes: JSON.stringify({ stages }),
  items: [
    { localId: 'a', materialName: 'Прозрачное М1', category: 'стекло', thickness: 8, quantity: 3, totalWeight: 30, saleIncVat: 700 },
    { localId: 'b', materialName: 'Серебро', category: 'зеркало', thickness: 4, quantity: 1, totalWeight: 5, saleIncVat: 300 },
  ],
})
const notesOf = (id: number) => JSON.parse(String(h.db.b2b_orders.find(o => o.id === id)?.notes)) as { stages: Row; client_shipment?: Row | null }
const create = async (lines: [number, string, number][], date = today) => {
  const r = await call({ action: 'create', ship_date: date, lines: lines.map(([order_id, line_key, qty]) => ({ order_id, line_key, qty })) })
  expect(r.status).toBe(200)
  return r.body.id
}

beforeEach(() => {
  h.db = { b2b_orders: [order(1), order(2, { shipped: '2026-10-31T13:51:31.115Z' }), order(3, {}, 99)], delivery_shipments: [], delivery_shipment_items: [], production_tasks: [] }
  h.canMoney = true; h.closed = []; h.reopened = []; h.role = 'admin'; h.packCalls = []; h.packUpdated = 1
})

describe('отгрузка Шовер Гласс: маршрут', () => {
  it('больше, чем есть, и чужой заказ не собираются', async () => {
    expect((await call({ action: 'create', ship_date: today, lines: [{ order_id: 1, line_key: 'a', qty: 4 }] })).status).toBe(409)
    expect((await call({ action: 'create', ship_date: today, lines: [{ order_id: 3, line_key: 'a', qty: 1 }] })).body.error).toContain('другого клиента')
    expect((await call({ action: 'create', ship_date: today, lines: [] })).status).toBe(409)
    await create([[1, 'a', 2]])
    expect((await call({ action: 'create', ship_date: today, lines: [{ order_id: 1, line_key: 'a', qty: 2 }] })).body.error).toContain('можно взять 1 из 3')
  })

  it('частичная отправка не ставит отметку, снимок части сходится с целым', async () => {
    const s1 = await create([[1, 'a', 1]])
    const d = await call({ action: 'dispatch', shipment_id: s1 })
    expect(d.body.shipped_orders).toEqual([])
    expect(notesOf(1).stages.shipped).toBeUndefined()
    expect(h.closed).toEqual([])
    const row = h.db.delivery_shipment_items.find(r => r.shipment_id === s1)
    expect(row).toMatchObject({ weight_kg: 10, amount: 233.33, label: 'Стекло прозрачное М1, 8 мм' })

    const s2 = await create([[1, 'a', 2], [1, 'b', 1]])
    const full = await call({ action: 'dispatch', shipment_id: s2 })
    expect(full.body.shipped_orders).toEqual([1])
    expect(notesOf(1).stages.shipped).toBe(`${today}T12:00:00+03:00`)
    expect(notesOf(1).client_shipment).toMatchObject({ id: s2, date: today, prev_shipped: null })
    expect(h.closed).toEqual([1])
    const sum = h.db.delivery_shipment_items.reduce((s, r) => s + Number(r.amount), 0)
    expect(Math.round(sum * 100) / 100).toBe(1000)
    expect(h.db.delivery_shipment_items.reduce((s, r) => s + Number(r.weight_kg), 0)).toBeCloseTo(35)
  })

  it('откат части снимает отметку и возвращает задачи, повтор отправки снова закрывает заказ', async () => {
    const s1 = await create([[1, 'a', 1]])
    await call({ action: 'dispatch', shipment_id: s1 })
    const s2 = await create([[1, 'a', 2], [1, 'b', 1]])
    await call({ action: 'dispatch', shipment_id: s2 })

    const u = await call({ action: 'undo', shipment_id: s1 })
    expect(u.body.reverted_orders).toEqual([1])
    expect(notesOf(1).stages.shipped).toBeNull()
    expect(notesOf(1).client_shipment).toBeNull()
    expect(h.reopened).toEqual([1])
    expect(h.db.delivery_shipments.find(s => s.id === s1)).toMatchObject({ status: 'draft', shipped_at: null })
    expect(h.db.delivery_shipment_items.find(r => r.shipment_id === s1)).toMatchObject({ label: null, weight_kg: null, amount: null })

    expect((await call({ action: 'dispatch', shipment_id: s1 })).body.shipped_orders).toEqual([1])
  })

  it('заказ уже был отмечен: отправка помнит прежнюю дату, откат возвращает её без задач цеха', async () => {
    const s = await create([[2, 'a', 3], [2, 'b', 1]])
    await call({ action: 'dispatch', shipment_id: s })
    expect(notesOf(2).stages.shipped).toBe(`${today}T12:00:00+03:00`)
    await call({ action: 'undo', shipment_id: s })
    expect(notesOf(2).stages.shipped).toBe('2026-10-31T13:51:31.115Z')
    expect(h.reopened).toEqual([])
  })

  it('будущая дата, повторная отправка, удаление отправленной — отказ', async () => {
    const future = await create([[1, 'a', 1]], '2099-01-01')
    expect((await call({ action: 'dispatch', shipment_id: future })).body.error).toContain('ещё не наступила')
    expect((await call({ action: 'delete', shipment_id: future })).status).toBe(200)
    expect(h.db.delivery_shipment_items).toEqual([])

    const s = await create([[1, 'a', 1]])
    expect((await call({ action: 'dispatch', shipment_id: s })).status).toBe(200)
    expect((await call({ action: 'dispatch', shipment_id: s })).status).toBe(409)
    expect((await call({ action: 'delete', shipment_id: s })).status).toBe(409)
  })

  it('отправленная отгрузка: довезли остаток в неё, заказ стал отгруженным её датой; убрали — отметка снята', async () => {
    const past = '2026-11-01'
    const s = await create([[1, 'a', 2]], past)
    await call({ action: 'dispatch', shipment_id: s })
    expect(notesOf(1).stages.shipped).toBeUndefined()
    const head = () => h.db.delivery_shipments.find(x => x.id === s)!

    expect((await call({ action: 'add', shipment_id: s, lines: [{ order_id: 1, line_key: 'a', qty: 2 }] })).status).toBe(409)
    const add1 = await call({ action: 'add', shipment_id: s, lines: [{ order_id: 1, line_key: 'a', qty: 1 }] })
    expect(add1.body.shipped_orders).toEqual([])
    expect(h.db.delivery_shipment_items.find(r => r.line_key === 'a')).toMatchObject({ qty: 3, weight_kg: 30, amount: 700 })
    expect(head()).toMatchObject({ status: 'shipped', total_weight_kg: 30 })

    const add2 = await call({ action: 'add', shipment_id: s, lines: [{ order_id: 1, line_key: 'b', qty: 1 }] })
    expect(add2.body.shipped_orders).toEqual([1])
    expect(notesOf(1).stages.shipped).toBe(`${past}T12:00:00+03:00`)
    expect(notesOf(1).client_shipment).toMatchObject({ id: s, date: past, prev_shipped: null })
    expect(h.db.delivery_shipment_items.find(r => r.line_key === 'b')).toMatchObject({ weight_kg: 5, amount: 300 })
    expect(head().total_weight_kg).toBe(35)
    expect(h.closed).toEqual([1])

    const rm = await call({ action: 'remove', shipment_id: s, order_id: 1, line_key: 'b' })
    expect(rm.body.reverted_orders).toEqual([1])
    expect(notesOf(1).stages.shipped).toBeNull()
    expect(notesOf(1).client_shipment).toBeNull()
    expect(h.reopened).toEqual([1])
    expect(head().total_weight_kg).toBe(30)

    const last = await call({ action: 'remove', shipment_id: s, order_id: 1, line_key: 'a' })
    expect(last.body.deleted).toBe(true)
    expect(h.db.delivery_shipments.find(x => x.id === s)).toBeUndefined()
  })

  it('добавление складывает штуки, удаление строки её убирает', async () => {
    const s = await create([[1, 'a', 1]])
    expect((await call({ action: 'add', shipment_id: s, lines: [{ order_id: 1, line_key: 'a', qty: 1 }, { order_id: 1, line_key: 'b', qty: 1 }] })).status).toBe(200)
    expect(h.db.delivery_shipment_items.find(r => r.line_key === 'a')?.qty).toBe(2)
    expect((await call({ action: 'add', shipment_id: s, lines: [{ order_id: 1, line_key: 'a', qty: 2 }] })).status).toBe(409)
    expect((await call({ action: 'remove', shipment_id: s, order_id: 1, line_key: 'b' })).status).toBe(200)
    expect(h.db.delivery_shipment_items).toHaveLength(1)
  })

  it('кнопка упаковки: пишет этап позиции, снятие снимает флаг заказа, ограничения', async () => {
    expect((await call({ action: 'pack', order_id: 1, line_key: 'b' })).status).toBe(200)
    expect(h.packCalls[0]).toEqual({ orderId: 1, item_index: 1, stage_key: 'packaging', action: 'done' })

    const row = h.db.b2b_orders.find(o => o.id === 1)!
    row.notes = JSON.stringify({ stages: { packaged: '2026-11-05', cut: '2026-11-05', tempering: '2026-11-04' } })
    expect((await call({ action: 'unpack', order_id: 1, line_key: 'b' })).body).toMatchObject({ ok: true, reopened: 2 })
    expect(h.packCalls[1]).toMatchObject({ action: 'unset', item_index: 1 })
    expect(notesOf(1).stages).toMatchObject({ packaged: null, cut: null, tempering: '2026-11-04' })

    await create([[1, 'b', 1]])
    expect((await call({ action: 'unpack', order_id: 1, line_key: 'b' })).body.error).toContain('уже в отгрузке')
    expect((await call({ action: 'pack', order_id: 1, line_key: 'нет' })).status).toBe(409)
    expect((await call({ action: 'pack', order_id: 2, line_key: 'a' })).body.error).toContain('уже отгружен')
    expect((await call({ action: 'pack', order_id: 3, line_key: 'a' })).body.error).toContain('другого клиента')

    h.packUpdated = 0
    expect((await call({ action: 'pack', order_id: 1, line_key: 'a' })).body.error).toContain('нет задачи упаковки')

    h.role = 'manager'
    expect((await call({ action: 'pack', order_id: 1, line_key: 'a' })).status).toBe(403)
    expect(((await (await GET()).json()) as { canPack: boolean }).canPack).toBe(false)
  })

  it('история: архив и просчёт видны, но не собираются', async () => {
    h.db.b2b_orders.push(
      { ...order(4), archived_at: '2026-10-09T10:00:00Z' },
      { ...order(5), notes: JSON.stringify({ status: 'quote' }) },
      { ...order(6), created_at: '2026-05-01T10:00:00Z', archived_at: '2026-06-01T10:00:00Z', custom_number: '006' },
    )
    const list = ((await (await GET()).json()) as { orders: (Row & { id: number })[] }).orders
    expect(list.find(o => o.id === 4)).toMatchObject({ hidden: 'archived', archived_day: '2026-10-09', deadline_day: null, overdue_days: 0 })
    expect(list.find(o => o.id === 5)).toMatchObject({ hidden: 'quote' })
    expect(list.some(o => o.id === 6)).toBe(false)
    expect((await call({ action: 'create', ship_date: today, lines: [{ order_id: 4, line_key: 'a', qty: 1 }] })).body.error).toContain('в архиве')
    expect((await call({ action: 'create', ship_date: today, lines: [{ order_id: 5, line_key: 'a', qty: 1 }] })).body.error).toContain('просчёт')
    expect((await call({ action: 'pack', order_id: 4, line_key: 'a' })).body.error).toContain('в архиве')
  })

  it('вкладки: частично уехавший и просроченный заказ остаётся в работе, уехавший целиком — в отгруженных', async () => {
    const row = h.db.b2b_orders.find(o => o.id === 1)!
    row.launched_at = '2026-10-01T10:00:00Z'
    row.notes = JSON.stringify({ stages: {}, deadline_date: '2026-10-08' })
    const read = async (id: number) => ((await (await GET()).json()) as { orders: (Row & { id: number })[] }).orders.find(o => o.id === id)!

    expect(await read(1)).toMatchObject({ stage: 'in_work', state: 'none', launch_day: '2026-10-01', deadline_day: '2026-10-08', packed_lines: 0 })
    expect(Number((await read(1)).overdue_days)).toBeGreaterThan(0)

    await call({ action: 'dispatch', shipment_id: await create([[1, 'b', 1]]) })
    expect(await read(1)).toMatchObject({ stage: 'in_work', state: 'partial', packed_lines: 1 })
    expect(Number((await read(1)).overdue_days)).toBeGreaterThan(0)

    await call({ action: 'dispatch', shipment_id: await create([[1, 'a', 3]]) })
    expect(await read(1)).toMatchObject({ stage: 'shipped', state: 'full', overdue_days: 0, marked_day: today })

    expect(await read(2)).toMatchObject({ stage: 'shipped', state: 'none', marked_outside: true, deadline_day: null, overdue_days: 0 })
  })

  it('чтение: сумма только с правом на деньги, сырых заметок и позиций наружу нет', async () => {
    await create([[1, 'a', 1]])
    const withMoney = await (await GET()).json() as { orders: { id: number; state: string; lines: Row[] }[]; shipments: { lines: Row[] }[] }
    expect(withMoney.orders.find(o => o.id === 1)?.lines[0]).toMatchObject({ qty: 3, drafted: 1, free: 2, amount: 700 })
    expect(withMoney.shipments[0].lines[0]).toMatchObject({ qty: 1, lineQty: 3, weight: 10, amount: 233.33 })
    h.canMoney = false
    const noMoney = await (await GET()).text()
    expect(noMoney).not.toContain('"amount"')
    expect(noMoney).not.toContain('saleIncVat')
    expect(noMoney).not.toContain('"notes"')
    expect(withMoney.orders.some(o => o.id === 3)).toBe(false)
  })
})
