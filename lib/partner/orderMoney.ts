import type { SupabaseClient } from '@supabase/supabase-js'
import { chunk, readPaged } from '@/lib/partner/readPaged'
import { isStageDone, stagesOf } from '@/lib/b2b/stageDone'

// Отметка «Оплачен»: notes.payment_status пишет только /api/b2b-orders/[id]/payment;
// этап invoice_paid — старая отметка с экрана заказов.
export function markedPaid(notes: Record<string, unknown>): boolean {
  return notes.payment_status === 'paid' || isStageDone(stagesOf(notes), 'invoice_paid')
}

// Выставленные счета по заказам — из реестра `invoices` (пачками: потолок 1000 строк).
// Отменённый счёт не считается выставленным.
export async function loadInvoicedOrders(svc: SupabaseClient, orderIds: readonly number[]): Promise<Set<number>> {
  const ids = [...new Set(orderIds)]
  const out = new Set<number>()
  for (const part of chunk(ids, 500)) {
    const rows = await readPaged<{ order_ids: unknown; status: string | null }>(() => svc.from('invoices')
      .select('id, order_ids, status').overlaps('order_ids', part).order('id'))
    const want = new Set(part)
    for (const r of rows) {
      if (r.status === 'cancelled' || !Array.isArray(r.order_ids)) continue
      for (const id of r.order_ids) if (want.has(Number(id))) out.add(Number(id))
    }
  }
  return out
}
