import type { SupabaseClient } from '@supabase/supabase-js'
import { paidByOrder, type InvoiceRow, type PaymentRow } from '@/lib/b2b/orderPayments'
import { finalTotalOf } from '@/lib/b2b/priceOverride'
import { readIn, num, type Row } from './paged'

// Сколько оплачено по заказам — из payments, та же раскладка, что /api/b2b-orders/payments
// (A23): прямой платёж по заказу + доля платежей по счетам, где заказ стоит рядом с другими.
// Суммы соседей по счёту дочитываются, иначе доля чужого заказа досталась бы нашему.

type PayRow = PaymentRow & { external_key: string | null }

const toPay = (p: Row): PayRow => ({
  amount: num(p.amount),
  b2b_order_id: p.b2b_order_id == null ? null : num(p.b2b_order_id),
  invoice_id: p.invoice_id == null ? null : num(p.invoice_id),
  voided_at: (p.voided_at as string | null) ?? null,
  external_key: (p.external_key as string | null) ?? null,
})

const PCOLS = 'id, amount, b2b_order_id, invoice_id, voided_at, external_key'

// orderTotals — итоги заказов, которые уже прочитаны (чтобы не читать дважды); недостающие дочитаем.
export async function loadOrderPaid(
  svc: SupabaseClient,
  orderTotals: Map<number, number>,
  opts: { excludeKeys?: string[] } = {},
): Promise<Map<number, number>> {
  const orderIds = [...orderTotals.keys()]
  if (orderIds.length === 0) return new Map()
  const exclude = new Set(opts.excludeKeys ?? [])

  const [direct, invoiceParts] = await Promise.all([
    readIn(orderIds, part => svc.from('payments').select(PCOLS).in('b2b_order_id', part).is('voided_at', null).order('id')),
    readIn(orderIds, part => svc.from('invoices').select('id, order_ids, amount').overlaps('order_ids', part).order('id')),
  ])

  const invoices = new Map<number, InvoiceRow>()
  for (const i of invoiceParts) {
    invoices.set(num(i.id), { id: num(i.id), order_ids: Array.isArray(i.order_ids) ? (i.order_ids as unknown[]).map(Number) : null, amount: num(i.amount) })
  }

  const totals = new Map(orderTotals)
  const missing = [...new Set([...invoices.values()].flatMap(i => i.order_ids ?? []))].filter(id => !totals.has(id))
  const invoiceIds = [...invoices.keys()]
  const [neighbours, viaInvoice] = await Promise.all([
    readIn(missing, part => svc.from('b2b_orders').select('id, total_after_discount, total_sale_inc_vat').in('id', part).order('id')),
    readIn(invoiceIds, part => svc.from('payments').select(PCOLS).in('invoice_id', part).is('voided_at', null).order('id')),
  ])
  for (const o of neighbours) totals.set(num(o.id), finalTotalOf(o as { total_after_discount?: number; total_sale_inc_vat?: number }))

  const pays: PayRow[] = [
    ...direct.map(toPay),
    // С прямой привязкой к заказу платёж уже посчитан выше — через счёт второй раз не берём.
    ...viaInvoice.map(toPay).filter(p => p.b2b_order_id == null),
  ].filter(p => !p.external_key || !exclude.has(p.external_key))

  const paid = paidByOrder(pays, [...invoices.values()], totals)
  const out = new Map<number, number>()
  for (const id of orderIds) out.set(id, Math.round((paid.get(id) ?? 0) * 100) / 100)
  return out
}

// Сколько дописать «Оплачен» по заказу: итог − всё, что уже пришло (выписка, счёт,
// предоплата). Свой прошлый платёж «остаток» в «пришло» не входит — его перезапишет upsert.
// Остаток меньше рубля — копейки раскладки счёта по заказам, не долг (EPS в orderPayments).
export function settlementAmount(total: number, paidOther: number): number {
  const rest = Math.round(((Number(total) || 0) - (Number(paidOther) || 0)) * 100) / 100
  return rest > 1 ? rest : 0
}
