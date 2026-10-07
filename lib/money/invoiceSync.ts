import type { SupabaseClient } from '@supabase/supabase-js'
import { finalTotalOf } from '@/lib/b2b/priceOverride'
import { readIn, num } from './paged'
import { attachInvoicePayments, asInvoiceRows } from './invoicePayments'
import { invoiceVat, type InvoicePayState } from './invoiceStatus'

// Счёт не застывает: пока он не оплачен (по платежам), его сумма, НДС и плательщик
// следуют за заказами. Оплаченный счёт — выданный и закрытый документ, его не трогаем.
// И один заказ — не больше одного неоплаченного счёта: иначе долг клиента задваивается.

export type InvoiceHeadFields = {
  amount: number
  vat: number
  payer_client_id: number | null
  payer_entity_id: number | null
  payer_name: string | null
}

const near = (a: number, b: number, eps: number) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < eps

// Что поменять в неоплаченном счёте под свежие данные; null — менять нечего.
// НДС сверяем до рубля: экраны округляют его по-разному (рубли/копейки) — это не правка.
export function invoiceChanges(current: InvoiceHeadFields, next: Partial<InvoiceHeadFields>): Partial<InvoiceHeadFields> | null {
  const patch: Partial<InvoiceHeadFields> = {}
  if (next.amount != null && !near(current.amount, next.amount, 0.01)) {
    patch.amount = Math.round(next.amount * 100) / 100
    patch.vat = next.vat != null ? next.vat : invoiceVat(next.amount)
  } else if (next.vat != null && !near(current.vat, next.vat, 1)) {
    patch.vat = next.vat
  }
  if (next.payer_entity_id !== undefined && (next.payer_entity_id ?? null) !== (current.payer_entity_id ?? null)) patch.payer_entity_id = next.payer_entity_id ?? null
  if (next.payer_client_id !== undefined && (next.payer_client_id ?? null) !== (current.payer_client_id ?? null)) patch.payer_client_id = next.payer_client_id ?? null
  if (next.payer_name !== undefined && (next.payer_name?.trim() || null) !== (current.payer_name?.trim() || null) && next.payer_name?.trim()) {
    patch.payer_name = next.payer_name.trim()
  }
  return Object.keys(patch).length ? patch : null
}

export type OpenInvoice = { id: number; invoice_no: string; order_ids: number[]; status: string; derivedStatus: InvoicePayState }

// Неоплаченные (по платежам) действующие счета, где уже стоит хоть один из этих заказов.
// Свой счёт с тем же набором заказов в пересечение не входит.
export function overlappingOpen(orderIds: number[], invoices: OpenInvoice[]): { invoice: OpenInvoice; orders: number[] }[] {
  const want = new Set(orderIds.map(Number))
  const key = [...want].sort((a, b) => a - b).join(',')
  const out: { invoice: OpenInvoice; orders: number[] }[] = []
  for (const inv of invoices) {
    if (inv.status === 'cancelled' || inv.derivedStatus === 'paid') continue
    if ([...new Set(inv.order_ids.map(Number))].sort((a, b) => a - b).join(',') === key) continue
    const common = inv.order_ids.map(Number).filter(id => want.has(id))
    if (common.length) out.push({ invoice: inv, orders: [...new Set(common)] })
  }
  return out
}

export function overlapMessage(hits: { invoice: OpenInvoice; orders: number[] }[], orderRef: (id: number) => string): string {
  const parts = hits.map(h => `${h.orders.map(orderRef).join(', ')} — в счёте № ${h.invoice.invoice_no}`)
  return `Заказ уже в неоплаченном счёте: ${parts.join('; ')}. Отмените тот счёт в «Реестре счетов» или уберите заказ из нового — иначе долг клиента задвоится.`
}

// Действующие счета, где есть эти заказы, со статусом оплаты по платежам.
export async function loadInvoicesWithOrders(svc: SupabaseClient, orderIds: number[]) {
  const rows = await readIn(orderIds, part => svc.from('invoices')
    .select('id, invoice_no, order_ids, amount, vat, status, payer_client_id, payer_entity_id, payer_name')
    .overlaps('order_ids', part).neq('status', 'cancelled').order('id'))
  const byId = new Map(rows.map(r => [num(r.id), r]))
  return attachInvoicePayments(svc, asInvoiceRows([...byId.values()]))
}

// После смены суммы заказа: пересчитать сумму и НДС неоплаченных счетов с этим заказом.
export async function syncInvoicesForOrders(svc: SupabaseClient, orderIds: number[]): Promise<{
  updated: { id: number; no: string; from: number; to: number }[]
  paidSkipped: string[]
}> {
  const invoices = await loadInvoicesWithOrders(svc, orderIds)
  const open = invoices.filter(i => i.derivedStatus !== 'paid')
  const paidSkipped = invoices.filter(i => i.derivedStatus === 'paid').map(i => String(i.invoice_no))
  const allOrders = [...new Set(open.flatMap(i => i.order_ids ?? []))]
  const orders = await readIn(allOrders, part => svc.from('b2b_orders').select('id, total_after_discount, total_sale_inc_vat').in('id', part).order('id'))
  const totals = new Map(orders.map(o => [num(o.id), finalTotalOf(o as { total_after_discount?: number; total_sale_inc_vat?: number })]))

  const updated: { id: number; no: string; from: number; to: number }[] = []
  for (const inv of open) {
    const ids = inv.order_ids ?? []
    if (ids.some(id => !totals.has(id))) continue   // заказ не нашёлся — сумму счёта не угадываем
    const amount = Math.round(ids.reduce((s, id) => s + (totals.get(id) ?? 0), 0) * 100) / 100
    const patch = invoiceChanges(
      { amount: Number(inv.amount) || 0, vat: num(inv.vat), payer_client_id: null, payer_entity_id: null, payer_name: null },
      { amount },
    )
    if (!patch) continue
    const { error } = await svc.from('invoices').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', inv.id)
    if (error) throw new Error(`Счёт № ${inv.invoice_no} не обновлён: ${error.message}`)
    updated.push({ id: inv.id, no: String(inv.invoice_no), from: Number(inv.amount) || 0, to: amount })
  }
  return { updated, paidSkipped }
}
