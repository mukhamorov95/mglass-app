import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { invoiceUpd, loadUpdByOrders } from '@/lib/accounting/invoiceUpd'
import { makeDb, fakeClient } from './fakeSupabase'

describe('УПД по счёту — из реестра', () => {
  it('номер и дата по каждому заказу счёта; без УПД — в «не выдан» с номером заказа', async () => {
    const db = makeDb({
      upd_registry: [{ id: 1, b2b_order_id: 10, year: 2026, number: 534, doc_date: '2026-10-05' }],
      b2b_orders: [{ id: 10, custom_number: 'B-10' }, { id: 11, custom_number: null }],
    })
    const { byOrder, refs } = await loadUpdByOrders(fakeClient(db) as unknown as SupabaseClient, [10, 11, 10])
    expect(byOrder).not.toBeNull()
    const u = invoiceUpd([10, 11], byOrder!, id => refs.get(id) ?? `#${id}`)
    expect(u.issued).toEqual([{ orderId: 10, year: 2026, number: 534, docDate: '2026-10-05' }])
    expect(u.missing).toEqual([{ orderId: 11, ref: '#11' }])
  })

  it('сбой чтения реестра — ошибка, а не «УПД не выдан»', async () => {
    const db = makeDb({ upd_registry: [], b2b_orders: [] })
    db.failTable = 'upd_registry'
    await expect(loadUpdByOrders(fakeClient(db) as unknown as SupabaseClient, [10])).rejects.toThrow(/Реестр УПД не прочитан/)
  })
})
