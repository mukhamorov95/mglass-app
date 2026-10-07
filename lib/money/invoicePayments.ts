import type { SupabaseClient } from '@supabase/supabase-js'
import { readIn, num, type Row } from './paged'
import { invoicePayments, type InvoiceLike, type InvoicePayment, type PaymentLike } from './invoiceStatus'

// Серверная часть статуса счёта: дочитать платежи к списку счетов без потолка 1000 строк.
// Только service-role и только после проверки роли в вызывающем маршруте.

export const PAYMENT_COLS = 'id, amount, invoice_id, b2b_order_id, voided_at, paid_at, external_key, source'

export const toPaymentLike = (p: Row): PaymentLike => ({
  id: num(p.id),
  amount: num(p.amount),
  invoice_id: p.invoice_id == null ? null : num(p.invoice_id),
  b2b_order_id: p.b2b_order_id == null ? null : num(p.b2b_order_id),
  voided_at: (p.voided_at as string | null) ?? null,
  paid_at: (p.paid_at as string | null) ?? null,
  external_key: (p.external_key as string | null) ?? null,
  source: (p.source as string | null) ?? null,
})

// Невойднутые платежи, которые могут относиться к этим счетам: по invoice_id и по заказам.
export async function loadPaymentsForInvoices(svc: SupabaseClient, invoices: InvoiceLike[]): Promise<PaymentLike[]> {
  const invIds = [...new Set(invoices.map(i => i.id))]
  const orderIds = [...new Set(invoices.flatMap(i => (i.order_ids ?? []).map(Number)).filter(n => n > 0))]
  const [byInvoice, byOrder] = await Promise.all([
    readIn(invIds, part => svc.from('payments').select(PAYMENT_COLS).in('invoice_id', part).is('voided_at', null).order('id')),
    readIn(orderIds, part => svc.from('payments').select(PAYMENT_COLS).in('b2b_order_id', part).is('voided_at', null).order('id')),
  ])
  const byId = new Map<number, PaymentLike>()
  for (const p of [...byInvoice, ...byOrder]) byId.set(num(p.id), toPaymentLike(p))
  return [...byId.values()]
}

export async function attachInvoicePayments<T extends InvoiceLike>(
  svc: SupabaseClient, invoices: T[],
): Promise<(T & InvoicePayment)[]> {
  if (invoices.length === 0) return []
  const pays = await loadPaymentsForInvoices(svc, invoices)
  const map = invoicePayments(invoices, pays)
  return invoices.map(inv => ({ ...inv, ...map.get(inv.id)! }))
}

export const toInvoiceLike = (i: Row): InvoiceLike & { status: string } => ({
  id: num(i.id),
  amount: num(i.amount),
  order_ids: Array.isArray(i.order_ids) ? (i.order_ids as unknown[]).map(Number) : [],
  status: String(i.status ?? 'issued'),
})

// Строка счёта из базы + нормализованные поля для расчёта оплаты (остальные колонки сохраняются).
export const asInvoiceRows = (rows: Row[]) =>
  rows.map(r => ({ ...r, ...toInvoiceLike(r) })) as (Row & InvoiceLike & { status: string })[]
