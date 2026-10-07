// Числа счёта-спецификации и УПД — отдельно от компонента: components/InvoiceDocument.tsx
// помечен 'use client', и его функции нельзя вызвать в API-маршруте (там они — клиентские
// ссылки). Выдача УПД строит документ на сервере, поэтому расчёт живёт здесь.

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
  const parts: string[] = [it.materialName || 'Стекло']
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
