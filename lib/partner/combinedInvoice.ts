import type { InvoicePayState } from '@/lib/money/invoiceStatus'

// Объединённый счёт из кабинета (владелец 25.11.2026): клиент собирает неоплаченные заказы в один
// счёт и платит одной суммой. Счёт — обычная запись реестра invoices: выписка банка находит его по
// номеру и сумме и раскладывает оплату по заказам (lib/partner/orderMoney loadPaidByOrders).
// УПД остаётся на каждый заказ.

export type RelatedInvoice = { id: number; invoice_no: string; order_ids: number[]; status: string; derivedStatus: InvoicePayState }

// Номер — как у сводного счёта менеджера: диапазон номеров заказов.
export function combinedInvoiceNo(orderNos: string[]): string {
  const nums = [...orderNos].sort()
  return nums.length > 1 ? `${nums[0]}–${nums[nums.length - 1]}` : (nums[0] ?? '')
}

// Что делать с прежними счетами этих заказов. Неоплаченный счёт целиком из выбранных заказов
// заменяется новым (отменяется). Счёт, где уже есть деньги, или с заказами вне выбора — стоп:
// иначе долг задвоится или оплата повиснет.
export function planCombined(orderIds: number[], related: RelatedInvoice[]): {
  same: RelatedInvoice | null; replace: RelatedInvoice[]; blocked: { invoice: RelatedInvoice; reason: 'paid' | 'outside' }[]
} {
  const set = new Set(orderIds)
  const key = [...set].sort((a, b) => a - b).join(',')
  const live = related.filter(r => r.status !== 'cancelled')
  const same = live.find(r => [...r.order_ids].sort((a, b) => a - b).join(',') === key) ?? null
  const replace: RelatedInvoice[] = []
  const blocked: { invoice: RelatedInvoice; reason: 'paid' | 'outside' }[] = []
  for (const r of live) {
    if (r === same) continue
    if (!r.order_ids.some(id => set.has(id))) continue
    if (r.derivedStatus !== 'unpaid') blocked.push({ invoice: r, reason: 'paid' })
    else if (r.order_ids.some(id => !set.has(id))) blocked.push({ invoice: r, reason: 'outside' })
    else replace.push(r)
  }
  return { same, replace, blocked }
}
