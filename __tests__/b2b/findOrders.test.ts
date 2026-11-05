import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { findOrders, orderLookupStatus } from '@/lib/b2b/findOrders'

type Row = Record<string, unknown>

// Запросы на базе в памяти: фильтры применяются по-настоящему, чтобы проверить, что куда попало.
function fakeDb(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = []
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => { filters.push(r => r[c] === v); return q },
        in: (c: string, v: unknown[]) => { filters.push(r => v.includes(r[c])); return q },
        ilike: (c: string, v: string) => {
          const needle = v.replace(/%/g, '').toLowerCase()
          filters.push(r => String(r[c] ?? '').toLowerCase().includes(needle))
          return q
        },
        order: () => q,
        limit: () => q,
        then: (ok: (v: { data: Row[]; error: null }) => unknown) => Promise.resolve({ data: (tables[table] ?? []).filter(r => filters.every(f => f(r))), error: null }).then(ok),
      }
      return q
    },
  } as unknown as SupabaseClient
}

const order = (id: number, over: Row = {}) => ({
  id, custom_number: `0${id}`, client_name: 'ShowerGlass', client_order_number: null, created_by: 'u1',
  created_at: '2026-09-29T10:00:00Z', launched_at: '2026-09-29', archived_at: null, notes: '{}', ...over,
})

describe('поиск заказа среди всех', () => {
  it('статус: архив, просчёт, отгружен, упакован, этап, не запущен', () => {
    const live = { archived_at: null, launched_at: '2026-10-01' }
    expect(orderLookupStatus({ archived_at: '2026-10-09T10:00:00Z', launched_at: null }, { status: 'quote' }, null)).toBe('В архиве с 09.10.2026')
    expect(orderLookupStatus({ archived_at: null, launched_at: null }, { status: 'quote' }, null)).toBe('Просчёт, не запущен')
    expect(orderLookupStatus(live, { stages: { shipped: '2026-11-03' } }, 'cutting')).toBe('Отгружен 03.11.2026')
    expect(orderLookupStatus(live, { stages: { shipped: true } }, null)).toBe('Отгружен')
    expect(orderLookupStatus(live, { stages: { packaged: '2026-11-01' } }, null)).toBe('Упакован 01.11.2026, ждёт отгрузки')
    expect(orderLookupStatus(live, {}, 'tempering')).toBe('В работе: Закалка')
    expect(orderLookupStatus(live, {}, null)).toBe('Запущен, открытых задач цеха нет')
    expect(orderLookupStatus({ archived_at: null, launched_at: null }, {}, null)).toBe('Не запущен')
  })

  it('номер находится с нулями и без, этап — самый ранний открытый', async () => {
    const db = fakeDb({
      b2b_orders: [order(5563, { notes: JSON.stringify({ stages: { shipped: '2026-11-03' } }) }), order(5564)],
      production_tasks: [
        { order_id: 5564, stage_key: 'packaging', sequence_order: 9, status: 'queued' },
        { order_id: 5564, stage_key: 'polishing', sequence_order: 2, status: 'queued' },
      ],
    })
    for (const q of ['5563', '05563', '005563']) {
      expect(await findOrders(db, q)).toEqual([{ id: 5563, no: '05563', client: 'ShowerGlass', created_day: '2026-09-29', status: 'Отгружен 03.11.2026' }])
    }
    expect((await findOrders(db, '5564'))[0].status).toBe('В работе: Полировка')
    expect(await findOrders(db, '99999')).toEqual([])
  })

  it('архив и просчёт находятся, клиент ищется по имени, короткий текст не ищется', async () => {
    const db = fakeDb({
      b2b_orders: [order(1, { archived_at: '2026-10-09T10:00:00Z' }), order(2, { notes: JSON.stringify({ status: 'quote' }) }), order(3, { client_name: 'Другой' })],
      production_tasks: [],
    })
    expect((await findOrders(db, '1'))[0].status).toBe('В архиве с 09.10.2026')
    expect((await findOrders(db, 'shower')).map(o => o.id)).toEqual([2, 1])
    expect(await findOrders(db, 'с')).toEqual([])
    expect(JSON.stringify(await findOrders(db, '2'))).not.toContain('notes')
  })

  it('менеджер видит только свои заказы', async () => {
    const db = fakeDb({ b2b_orders: [order(1), order(2, { created_by: 'u2' })], production_tasks: [] })
    expect((await findOrders(db, 'shower', 'u1')).map(o => o.id)).toEqual([1])
    expect(await findOrders(db, '2', 'u1')).toEqual([])
    expect((await findOrders(db, 'shower')).map(o => o.id)).toEqual([2, 1])
  })
})
