// Числа счёта-спецификации и УПД — отдельно от компонента: components/InvoiceDocument.tsx
// помечен 'use client', и его функции нельзя вызвать в API-маршруте (там они — клиентские
// ссылки). Выдача УПД строит документ на сервере, поэтому расчёт живёт здесь.

import { materialWithKind } from '@/lib/materialLabel'

export type InvoiceOrderItem = {
  materialName?: string; category?: string; thickness?: number; width?: number; height?: number
  quantity?: number; saleIncVat?: number; hasTempering?: boolean; hasFacet?: boolean
  facetTypeMm?: number; shape?: string; comment?: string; services?: { id: number; name: string; cost: number }[]
  // Договорная цена строки (вкл. НДС, ПОСЛЕ скидки). Если стоит — скидка к ней не применяется.
  manualTotal?: number | null
  // Цена из прайса клиента — скидка заказа к ней не применяется (как в b2bCalculator).
  clientPriced?: boolean
}
export type InvoiceOrder = {
  id: number; custom_number: string | null; discount_percent: number
  items: InvoiceOrderItem[]; total_sale_inc_vat: number; total_after_discount: number
  notes: string | null; created_at: string
}
export type InvoiceRequisites = {
  full_name: string; inn: string; kpp: string; ogrn: string; legal_address: string
  bank_account: string; bank_name: string; bik: string; corr_account: string
  supply_contract_no: string; supply_contract_date: string
}

export function itemName(it: InvoiceOrderItem): string {
  const parts: string[] = [materialWithKind(it, 'Стекло')]
  if (it.thickness) parts.push(`${it.thickness} мм`)
  if (it.hasTempering) parts.push('закалённое')
  if (it.hasFacet) parts.push(it.facetTypeMm ? `фацет ${it.facetTypeMm} мм` : 'фацет')
  const svc = (it.services ?? []).map(s => s.name).filter(Boolean)
  let base = parts.join(', ')
  if (it.width && it.height) base += `, ${it.width}×${it.height} мм`
  if (svc.length) base += `; ${svc.join(', ')}`
  return base
}

// Те же итоги, что в менеджерском счёте: разницу округления сажаем в последнюю строку.
export function computeInvoiceTotals(order: InvoiceOrder) {
  const items = order.items || []
  const discount = order.discount_percent || 0
  const totalBase = order.total_sale_inc_vat || items.reduce((s, i) => s + (i.saleIncVat ?? 0), 0)
  const totalPay = order.total_after_discount || totalBase
  const vat = Math.round(totalPay * 22 / 122 * 100) / 100
  // Договорная цена строки важнее прайса со скидкой — иначе счёт разойдётся
  // с просчётом там, где менеджер правил цены руками (или корректировал итог).
  const lineSums = items.map(it => it.manualTotal != null
    ? Math.round(Number(it.manualTotal) * 100) / 100
    : Math.round((it.saleIncVat ?? 0) * (1 - (it.clientPriced ? 0 : discount) / 100) * 100) / 100)
  if (lineSums.length) {
    const raw = Math.round(lineSums.reduce((a, b) => a + b, 0) * 100) / 100
    lineSums[lineSums.length - 1] = Math.round((lineSums[lineSums.length - 1] + (totalPay - raw)) * 100) / 100
  }
  return { items, discount, totalBase, totalPay, vat, lineSums, discountSum: totalBase - totalPay }
}

// Объединённый счёт на несколько заказов одним документом (кабинет, 25.11.2026): строки всех
// заказов, у каждой — договорная сумма строки своего заказа (скидки и округления — как в счёте
// заказа), под строкой — номер заказа. Итог = сумма итогов заказов, сходится копейка в копейку.
export function mergeInvoiceOrders(
  orders: (InvoiceOrder & { no: string })[],
  head: { id: number; invoiceNo: string; issuedAt: string },
): InvoiceOrder {
  const items: InvoiceOrderItem[] = []
  let total = 0
  for (const o of orders) {
    const t = computeInvoiceTotals(o)
    total += t.totalPay
    t.items.forEach((it, i) => items.push({
      ...it, manualTotal: t.lineSums[i],
      comment: [`заказ ${o.no}`, it.comment].filter(Boolean).join(' · '),
    }))
  }
  total = Math.round(total * 100) / 100
  return {
    id: head.id, custom_number: head.invoiceNo, discount_percent: 0, items,
    total_sale_inc_vat: total, total_after_discount: total,
    notes: JSON.stringify({ quote_date: head.issuedAt }), created_at: head.issuedAt,
  }
}

// Основание объединённого счёта (Шовер Гласс 25.11): номера заказов в назначение платежа —
// по ним клиент сверяет оплату; их собственный номер — в скобках, если указан.
export function invoiceBasis(orders: { no: string; theirNo?: string | null }[]): string | null {
  if (orders.length === 0) return null
  const parts = orders.map(o => `№ ${o.no}${o.theirNo ? ` (ваш № ${o.theirNo})` : ''}`)
  return `Оплата ${orders.length === 1 ? 'заказа' : 'заказов'} ${parts.join(', ')}`
}

// Назначение платежа в QR режется на 210 знаках. Номер счёта — первым: по нему выписка
// находит счёт, а список из 28 заказов целиком не помещается. Номера заказов — сколько влезет.
export const PURPOSE_MAX = 200
export function paymentPurpose(invoiceNo: string, orderNos: string[] = []): string {
  const head = `Оплата по счёту-спецификации № ${invoiceNo}`
  if (orderNos.length === 0) return head
  const text = (n: number) => `${head}. Заказы № ${orderNos.slice(0, n).join(', ')}${n < orderNos.length ? ` и ещё ${orderNos.length - n}` : ''}`
  for (let n = orderNos.length; n > 0; n--) if (text(n).length <= PURPOSE_MAX) return text(n)
  return head
}
