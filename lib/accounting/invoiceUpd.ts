import type { SupabaseClient } from '@supabase/supabase-js'
import { readIn, num } from '@/lib/money/paged'
import { missingSchema } from '@/lib/b2b/updRegistry'

// УПД по счёту — из реестра upd_registry (номер и дата выдачи), по заказам счёта.
// Ручная отметка invoices.upd_issued_at больше не источник: она расходилась с реестром.

export type UpdRef = { orderId: number; year: number; number: number; docDate: string }
export type InvoiceUpd = { issued: UpdRef[]; missing: { orderId: number; ref: string }[] }

export function invoiceUpd(orderIds: number[], byOrder: Map<number, UpdRef>, refOf: (id: number) => string): InvoiceUpd {
  const issued: UpdRef[] = []
  const missing: InvoiceUpd['missing'] = []
  for (const id of orderIds) {
    const u = byOrder.get(id)
    if (u) issued.push(u)
    else missing.push({ orderId: id, ref: refOf(id) })
  }
  return { issued, missing }
}

// null — реестр ещё не включён (миграция не применена): это не «УПД нет».
export async function loadUpdByOrders(svc: SupabaseClient, orderIds: number[]): Promise<{
  byOrder: Map<number, UpdRef> | null; refs: Map<number, string>
}> {
  const ids = [...new Set(orderIds.filter(n => n > 0))]
  let byOrder: Map<number, UpdRef> | null = new Map()
  try {
    const rows = await readIn(ids, part => svc.from('upd_registry')
      .select('id, b2b_order_id, year, number, doc_date').in('b2b_order_id', part).order('id'))
    for (const r of rows) {
      byOrder.set(num(r.b2b_order_id), { orderId: num(r.b2b_order_id), year: num(r.year), number: num(r.number), docDate: String(r.doc_date) })
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (!missingSchema({ message })) throw new Error(`Реестр УПД не прочитан: ${message}`)
    byOrder = null
  }
  const orders = await readIn(ids, part => svc.from('b2b_orders').select('id, custom_number').in('id', part).order('id'))
  const refs = new Map(orders.map(o => [num(o.id), String(o.custom_number ?? '').trim() || `#${num(o.id)}`]))
  return { byOrder, refs }
}
