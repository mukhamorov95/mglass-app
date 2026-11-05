import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Маршрут закалки целиком, на базе в памяти: лист, отправка, приёмка, бой и повторная отправка. Прод здесь не участвует.

type Row = Record<string, unknown>
const h = vi.hoisted(() => ({
  db: {} as Record<string, Record<string, unknown>[]>,
  seq: 100,
  role: 'production',
  canMoney: true,
  reworks: [] as Record<string, unknown>[],
  details: [] as Record<string, unknown>[],
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
      out = (Array.isArray(payload) ? payload : [payload as Row]).map(p => ({ id: ++h.seq, created_at: 'x', sent_at: null, sent_by_name: null, ...p }))
      rows().push(...out)
    } else if (op === 'upsert') {
      out = []
      for (const p of payload as Row[]) {
        const hit = rows().find(r => r.batch_id === p.batch_id && r.order_id === p.order_id && r.line_key === p.line_key && r.layer === p.layer)
        if (hit) Object.assign(hit, p)
        else rows().push({ id: ++h.seq, returned_qty: 0, broken_qty: 0, received_at: null, received_by_name: null, ...p })
        out.push(p)
      }
    } else if (op === 'update') {
      out = rows().filter(match)
      for (const r of out) Object.assign(r, payload)
    } else if (op === 'delete') {
      out = rows().filter(match)
      h.db[table] = rows().filter(r => !match(r))
      if (table === 'tempering_batches') h.db.tempering_batch_items = (h.db.tempering_batch_items ?? []).filter(i => !out.some(s => s.id === i.batch_id))
    } else out = rows().filter(match)
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
    neq: (c: string, v: unknown) => { filters.push(r => r[c] !== v); return q },
    lte: (c: string, v: number) => { filters.push(r => Number(r[c]) <= v); return q },
    in: (c: string, v: unknown[]) => { filters.push(r => v.includes(r[c])); return q },
    order: () => q,
    range: (a: number, b: number) => { slice = [a, b]; return q },
    maybeSingle: () => { one = true; return q },
    single: () => { one = true; return q },
    then: (ok: (v: ReturnType<typeof run>) => unknown) => Promise.resolve(run()).then(ok),
  }
  return q
}
const rpc = (name: string, args: { p_updates?: Row[] }) => {
  if (name === 'mark_detail_stages') h.details.push(...(args.p_updates ?? []))
  return Promise.resolve({ error: null })
}

vi.mock('server-only', () => ({}))
vi.mock('@/lib/apiAuth', () => ({ requirePageAccess: async () => h.role }))
vi.mock('@/lib/getRole', () => ({
  getSessionUser: async () => ({ id: 'u1', email: 'x@test' }),
  getUserProfile: async () => ({ canViewMoney: h.canMoney }),
}))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => ({ from: query, rpc }) }))
vi.mock('@/lib/productionOrderMirror', () => ({ mirrorOrderStages: async () => undefined }))
vi.mock('@/lib/production/consumeBridge', () => ({ consumeCutting: async () => 0, reverseCutting: async () => 0, loadCascadedTasks: async () => [] }))
vi.mock('@/lib/b2b/rates', () => ({ loadB2BRates: async () => ({ rates: { temperingPerM2: { 8: 500 }, transportPerPiece: 77 }, missing: [] }) }))
vi.mock('@/lib/b2b/findOrders', () => ({ findOrders: async () => [{ id: 1, no: '01', client: 'К', created_day: '2026-10-01', status: 'В работе' }] }))
vi.mock('@/lib/production/reworkApply', () => ({
  applyRework: async (_s: unknown, input: Row & { order: { id: number }; itemIndex: number }) => {
    h.reworks.push(input)
    for (const t of h.db.production_tasks) if (t.order_id === input.order.id && t.item_index === input.itemIndex) Object.assign(t, { status: 'queued', auto_closed: false })
    return { ok: true, foundAtStage: 'tempering', restartStage: 'cutting', reopen: 2 }
  },
  unmirrorReopenedStages: async () => undefined,
}))

import { GET, POST } from '@/app/api/production/tempering/route'
import { mskDayKey } from '@/lib/time'

const today = mskDayKey()
const call = async (body: Row) => {
  const r = await POST(new NextRequest('http://t/api', { method: 'POST', body: JSON.stringify(body) }))
  return { status: r.status, body: await r.json() as Row & { id: number; error: string; returned: number; broken: number; deleted: boolean; warnings: string[] } }
}
const read = async (qs = '') => {
  const r = await GET(new NextRequest(`http://t/api${qs}`))
  return { status: r.status, body: await r.json() as { canMoney: boolean; pool: { id: number; lines: { key: string; free: number; before: string[]; task: string }[] }[]; batches: { id: number; status: string; lines: Row[] }[]; found: { id: number; blocked: boolean; lines: unknown[] }[]; error: string } }
}
const order = (id: number, notes: Row = {}, extra: Row = {}) => ({
  id, custom_number: `0${id}`, client_name: 'Клиент', archived_at: null, created_at: '2026-10-01T10:00:00Z', launched_at: '2026-10-02T10:00:00Z',
  discount_percent: 0, total_sale_inc_vat: 1000, total_after_discount: 1000, notes: JSON.stringify(notes),
  items: [
    { localId: 'a', materialName: 'Осветлённое CrystalVision', thickness: 8, width: 600, height: 1000, quantity: 3, hasTempering: true, totalWeight: 36, saleIncVat: 900 },
    { localId: 'm', materialName: 'Серебро', category: 'зеркало', thickness: 4, width: 500, height: 500, quantity: 1, saleIncVat: 100 },
  ],
  ...extra,
})
const task = (orderId: number, stage: string, seq: number, status = 'queued', item = 0) => ({
  id: ++h.seq, order_id: orderId, item_index: item, stage_key: stage, sequence_order: seq, status, layer: 1, started_at: null, rework_count: 0, auto_closed: false, auto_closed_from: null,
})
const taskOf = (stage: string, orderId = 1) => h.db.production_tasks.find(t => t.order_id === orderId && t.stage_key === stage)!
const create = async (qty: number, date = today) => {
  const r = await call({ action: 'create', batch_date: date, lines: [{ order_id: 1, line_key: 'a', layer: 1, qty }] })
  expect(r.status).toBe(200)
  return r.body.id
}
const rowOf = (batch: number) => h.db.tempering_batch_items.find(r => r.batch_id === batch)!

beforeEach(() => {
  h.seq = 100
  h.db = {
    b2b_orders: [order(1), order(2, { stages: { shipped: '2026-11-01T10:00:00Z' } }), order(3, {}, { archived_at: '2026-11-01T10:00:00Z' })],
    tempering_batches: [], tempering_batch_items: [], users: [{ id: 'u1', name: 'Никита' }],
  }
  h.db.production_tasks = [task(1, 'cutting', 1), task(1, 'polishing', 2), task(1, 'tempering', 3), task(1, 'packaging', 4), task(2, 'tempering', 1), task(3, 'tempering', 1)]
  h.role = 'production'; h.canMoney = true; h.reworks = []; h.details = []
})

describe('закалка: маршрут', () => {
  it('в списке ждущих только запущенные заказы с открытой закалкой, зеркала нет; неотмеченные этапы названы', async () => {
    const { body } = await read()
    expect(body.pool.map(o => o.id)).toEqual([1])
    expect(body.pool[0].lines).toHaveLength(1)
    expect(body.pool[0].lines[0]).toMatchObject({ key: 'a', free: 3, task: 'open', before: ['Резка', 'Полировка'] })
  })

  it('менеджер не видит и не пишет; деньги только с правом', async () => {
    h.role = 'manager'
    expect((await read()).status).toBe(403)
    expect((await call({ action: 'create', batch_date: today, lines: [] })).status).toBe(403)
    h.role = 'production'; h.canMoney = false
    await create(2)
    const line = (await read()).body.batches[0].lines[0]
    expect(line).toMatchObject({ cost: null, amount: 0, transport: 0, area_m2: 1.2 })
    expect(rowOf(h.db.tempering_batches[0].id as number)).toMatchObject({ cost: 600, transport: 154 })
  })

  it('больше свободного, отгруженный и архивный заказ в лист не идут', async () => {
    expect((await call({ action: 'create', batch_date: today, lines: [{ order_id: 1, line_key: 'a', layer: 1, qty: 4 }] })).body.error).toContain('можно отправить 3 из 3')
    expect((await call({ action: 'create', batch_date: today, lines: [{ order_id: 1, line_key: 'm', layer: 1, qty: 1 }] })).status).toBe(409)
    expect((await call({ action: 'create', batch_date: today, lines: [{ order_id: 2, line_key: 'a', layer: 1, qty: 1 }] })).body.error).toContain('уже отгружен')
    expect((await call({ action: 'create', batch_date: today, lines: [{ order_id: 3, line_key: 'a', layer: 1, qty: 1 }] })).body.error).toContain('архиве')
    expect(h.db.tempering_batches).toEqual([])
  })

  it('черновик ничего не меняет в цехе; будущую дату не отправить', async () => {
    const future = await create(1, '2099-01-01')
    expect(taskOf('tempering').status).toBe('queued')
    expect((await call({ action: 'send', batch_id: future })).body.error).toContain('ещё не наступила')
    expect((await call({ action: 'delete', batch_id: future })).status).toBe(200)
    expect(h.db.tempering_batch_items).toEqual([])
  })

  it('часть строки: закалка начата, этапы до неё не закрыты; остаток в отправленный лист закрывает их', async () => {
    const b = await create(2)
    await call({ action: 'send', batch_id: b })
    expect(taskOf('tempering').status).toBe('in_progress')
    expect(taskOf('cutting').status).toBe('queued')
    expect((await read()).body.pool[0].lines[0].free).toBe(1)

    await call({ action: 'add', batch_id: b, lines: [{ order_id: 1, line_key: 'a', layer: 1, qty: 1 }] })
    expect(rowOf(b)).toMatchObject({ qty: 3, cost: 900 })
    expect(taskOf('cutting')).toMatchObject({ status: 'done', auto_closed: true, auto_closed_from: 'tempering_sent' })
    expect(taskOf('polishing').status).toBe('done')
    expect(taskOf('packaging').status).toBe('queued')
    expect(h.details.map(d => d.stage)).toEqual(['cutting', 'polishing'])
  })

  it('возврат в черновик возвращает только закрытое отправкой, живую отметку не трогает', async () => {
    taskOf('cutting').status = 'done'
    const b = await create(3)
    await call({ action: 'send', batch_id: b })
    expect(taskOf('polishing').auto_closed_from).toBe('tempering_sent')
    expect((await call({ action: 'undo', batch_id: b })).status).toBe(200)
    expect(taskOf('polishing')).toMatchObject({ status: 'queued', auto_closed: false, auto_closed_from: null })
    expect(taskOf('cutting').status).toBe('done')
    expect(taskOf('tempering').status).toBe('queued')
    expect(h.db.tempering_batches[0].status).toBe('draft')
  })

  it('всё приехало: этап закалки закрыт, лист без остатка; повторно принять нечего', async () => {
    const b = await create(3)
    await call({ action: 'send', batch_id: b })
    const r = await call({ action: 'receive', batch_id: b })
    expect(r.body.returned).toBe(3)
    expect(taskOf('tempering').status).toBe('done')
    expect(taskOf('packaging').status).toBe('queued')
    expect(rowOf(b)).toMatchObject({ returned_qty: 3, received_by_name: 'Никита' })
    expect(h.details.map(d => d.stage)).toContain('tempering')
    expect((await call({ action: 'receive', batch_id: b })).status).toBe(409)
    expect((await call({ action: 'undo', batch_id: b })).status).toBe(409)
  })

  it('бой: переделка поставлена, разбитая штука снова свободна, второй лист закрывает закалку', async () => {
    const b = await create(3)
    await call({ action: 'send', batch_id: b })
    const row = rowOf(b)
    expect((await call({ action: 'receive', batch_id: b, rows: [{ id: row.id, returned: 3, broken: 1 }] })).body.error).toContain('осталось 3')

    const r = await call({ action: 'receive', batch_id: b, rows: [{ id: row.id, returned: 2, broken: 1 }] })
    expect(r.body).toMatchObject({ returned: 2, broken: 1 })
    expect(h.reworks).toHaveLength(1)
    expect(h.reworks[0]).toMatchObject({ reason: 'break_tempering', itemIndex: 0 })
    expect(String(h.reworks[0].comment)).toContain('Бой на закалке: 1 из 3 шт.')
    expect(taskOf('tempering').status).toBe('queued')
    expect((await read()).body.pool[0].lines[0].free).toBe(1)

    const again = await create(1)
    await call({ action: 'send', batch_id: again })
    await call({ action: 'receive', batch_id: again })
    expect(taskOf('tempering').status).toBe('done')
  })

  it('убрать строку можно, пока её не принимали; последняя удаляет лист', async () => {
    const b = await create(3)
    await call({ action: 'send', batch_id: b })
    const row = rowOf(b)
    const r = await call({ action: 'remove', batch_id: b, row_id: row.id })
    expect(r.body.deleted).toBe(true)
    expect(h.db.tempering_batches).toEqual([])
    expect(taskOf('cutting').status).toBe('queued')
    expect(taskOf('tempering').status).toBe('queued')
  })

  it('поиск находит заказ вне списка и говорит, что его нельзя отправить', async () => {
    const { body } = await read('?find=01')
    expect(body.found[0]).toMatchObject({ id: 1, blocked: false })
    expect(body.found[0].lines).toHaveLength(1)
  })
})
