import type { SupabaseClient } from '@supabase/supabase-js'
import { missingSchema } from '@/lib/b2b/updRegistry'
import { chunk, readPaged } from '@/lib/partner/readPaged'
import type { UpdShort } from '@/lib/partner/documents'

// Выданные УПД по заказам — пачками (потолок PostgREST 1000 строк). Нет таблицы
// реестра (SQL этапа 7 не выполнен) — пусто: черновик в кабинете не показываем.
export async function loadUpdByOrders(svc: SupabaseClient, orderIds: readonly number[]): Promise<Map<number, UpdShort>> {
  const out = new Map<number, UpdShort>()
  for (const part of chunk([...new Set(orderIds)], 500)) {
    let rows: { b2b_order_id: number; number: number; year: number; doc_date: string }[]
    try {
      rows = await readPaged(() => svc.from('upd_registry')
        .select('b2b_order_id, number, year, doc_date')
        .in('b2b_order_id', part)
        .order('b2b_order_id'))
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (missingSchema({ message })) return out
      throw e
    }
    for (const r of rows) out.set(Number(r.b2b_order_id), { number: Number(r.number), year: Number(r.year), docDate: r.doc_date })
  }
  return out
}
