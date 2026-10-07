import type { SupabaseClient } from '@supabase/supabase-js'
import { chunk, readPaged, type Paged } from '@/lib/partner/readPaged'
import { isStageDone, stagesOf } from '@/lib/b2b/stageDone'
import { paidByOrder, remainderStatus, type InvoiceRow, type PaymentRow } from '@/lib/b2b/orderPayments'
import { finalTotalOf } from '@/lib/b2b/priceOverride'

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

type Row = Record<string, unknown>
const num = (v: unknown) => Number(v) || 0

// Сколько оплачено по заказам — из payments (единственный источник денег, A23), та же
// раскладка, что /api/b2b-orders/payments: прямой платёж по заказу или платёж по счёту,
// разложенный на его заказы пропорционально суммам. Войднутые не считаются.
export async function loadPaidByOrders(svc: SupabaseClient, orderIds: readonly number[]): Promise<Map<number, number>> {
  const ids = [...new Set(orderIds)]
  if (ids.length === 0) return new Map()
  const inParts = <T>(list: number[], build: (part: number[]) => Paged) =>
    Promise.all(chunk(list, 500).map(part => readPaged<T>(() => build(part)))).then(x => x.flat())

  const [direct, invoiceRows] = await Promise.all([
    inParts<Row>(ids, part => svc.from('payments').select('id, amount, b2b_order_id, invoice_id, voided_at')
      .in('b2b_order_id', part).is('voided_at', null).order('id')),
    inParts<Row>(ids, part => svc.from('invoices').select('id, order_ids, amount').overlaps('order_ids', part).order('id')),
  ])
  const invoices = new Map<number, Row>()
  for (const i of invoiceRows) invoices.set(num(i.id), i)
  const invoiceIds = [...invoices.keys()]
  const byInvoice = invoiceIds.length
    ? await inParts<Row>(invoiceIds, part => svc.from('payments').select('id, amount, b2b_order_id, invoice_id, voided_at')
      .in('invoice_id', part).is('voided_at', null).order('id'))
    : []

  // Доли счёта считаются от сумм всех его заказов, в том числе не из этого списка.
  const allOrderIds = new Set<number>(ids)
  for (const i of invoices.values()) for (const id of (Array.isArray(i.order_ids) ? i.order_ids : [])) allOrderIds.add(num(id))
  const totals = new Map<number, number>()
  const orderRows = await inParts<Row>([...allOrderIds], part => svc.from('b2b_orders')
    .select('id, total_after_discount, total_sale_inc_vat').in('id', part).order('id'))
  for (const o of orderRows) totals.set(num(o.id), finalTotalOf(o as { total_after_discount?: number | null; total_sale_inc_vat?: number | null }))

  const toPayment = (p: Row): PaymentRow => ({
    amount: num(p.amount), b2b_order_id: p.b2b_order_id == null ? null : num(p.b2b_order_id),
    invoice_id: p.invoice_id == null ? null : num(p.invoice_id), voided_at: (p.voided_at as string | null) ?? null,
  })
  const payments: PaymentRow[] = [
    ...direct.map(toPayment),
    ...byInvoice.map(toPayment).filter(p => p.b2b_order_id == null),
  ]
  const invRows: InvoiceRow[] = [...invoices.values()].map(i => ({
    id: num(i.id), order_ids: Array.isArray(i.order_ids) ? (i.order_ids as unknown[]).map(Number) : null, amount: num(i.amount),
  }))
  const paid = paidByOrder(payments, invRows, totals)
  const out = new Map<number, number>()
  for (const id of ids) out.set(id, Math.round(paid.get(id) ?? 0))
  return out
}

export type PaymentView =
  | { status: 'paid' }
  | { status: 'partial'; paid: number; total: number; remainder: number }
  | { status: 'awaiting'; total: number }

// Что сказать партнёру об оплате. Платежи — главный источник; без них — отметка
// менеджера (payment_status / prepayment_amount в notes). null — платить ещё не время.
export function paymentView(o: {
  total: number
  paidFromPayments: number
  notes: Record<string, unknown>
  due: boolean   // заказ в работе или точке выставлен счёт
}): PaymentView | null {
  const total = Math.round(o.total)
  if (markedPaid(o.notes)) return { status: 'paid' }
  const marked = o.notes.payment_status === 'partial' ? Math.round(Number(o.notes.prepayment_amount) || 0) : 0
  const paid = o.paidFromPayments > 0 ? Math.round(o.paidFromPayments) : marked
  const st = remainderStatus(total, paid)
  if (st.hasPayment && st.remainder <= 1) return { status: 'paid' }
  if (st.hasPayment) return { status: 'partial', paid: st.paid, total: st.total, remainder: st.remainder }
  return o.due ? { status: 'awaiting', total } : null
}

// К оплате онлайн — остаток, а не вся сумма заказа.
export function amountDue(view: PaymentView | null): number {
  if (!view || view.status === 'paid') return 0
  return view.status === 'partial' ? view.remainder : view.total
}
