// Содержимое УПД как данные (этап 7 docs/b2b/ORDER_PANEL_ROUTE.md). Черновик собирается из
// заказа на лету; выданный УПД печатается из snapshot, сохранённого при выдаче, — правка
// заказа после выдачи документ не меняет. Чистые функции: snapshot строит сервер.

import { SELLER_B2B } from '@/lib/companyRequisites'
import { itemName, type InvoiceOrder, type InvoiceRequisites } from '@/lib/b2b/invoiceMath'
import { updLines, type UpdTotals } from '@/lib/b2b/updLines'

export type UpdViewLine = {
  name: string; qty: number; unitCode: string; unitName: string
  priceNoVat: number; sumNoVat: number; vatRate: number; vat: number; sumIncVat: number
}

// То, что сохраняется при выдаче: всё, кроме номера и даты (они — колонки реестра).
export type UpdBody = {
  v: 1
  orderNumber: string
  seller: { name: string; address: string; inn: string; kpp: string; directorTitle: string; directorShort: string }
  buyer: { name: string; address: string; inn: string; kpp: string }
  contract: string
  lines: UpdViewLine[]
  totals: UpdTotals
}

export type UpdView = UpdBody & { number: string; docDate: string }

export type UpdIssued = {
  year: number; number: number; doc_date: string
  snapshot: UpdBody
  issued_at: string; issued_by_name: string | null
}

const fmtDate = (s: string) => new Date(s).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric' })

function parseNotes(notes: string | null): Record<string, unknown> {
  if (!notes) return {}
  try { const p = JSON.parse(notes); if (typeof p === 'object' && p !== null) return p } catch {}
  return {}
}

export const updOrderNumber = (order: Pick<InvoiceOrder, 'id' | 'custom_number'>) =>
  order.custom_number?.trim() || String(order.id).padStart(5, '0')

export function buildUpdBody(order: InvoiceOrder, req: InvoiceRequisites, buyerName: string, docDate: string): UpdBody {
  const orderNumber = updOrderNumber(order)
  const notes = parseNotes(order.notes)
  const contract = req.supply_contract_no
    ? `Договор поставки № ${req.supply_contract_no}${req.supply_contract_date ? ` от ${fmtDate(req.supply_contract_date)}` : ''}`
    // Без рамочного договора бухгалтерия пишет так (УПД № 532: «Договор поставки № 05544 от 25.09.2026»
    // — номер заказа и дата просчёта/счёта-спецификации).
    : `Договор поставки № ${orderNumber} от ${fmtDate((notes.quote_date as string) || order.created_at)}`
  const { lines, totals } = updLines(order, docDate)
  return {
    v: 1,
    orderNumber,
    seller: {
      name: SELLER_B2B.nameFull, address: SELLER_B2B.legalAddressFull,
      inn: SELLER_B2B.inn, kpp: SELLER_B2B.kpp,
      directorTitle: SELLER_B2B.directorTitle, directorShort: SELLER_B2B.directorShort,
    },
    buyer: {
      name: (req.full_name || buyerName || '').trim(),
      address: (req.legal_address || '').trim(),
      inn: (req.inn || '').trim(), kpp: (req.kpp || '').trim(),
    },
    contract,
    lines: lines.map((l, i) => ({
      name: itemName(order.items[i]), qty: l.qty, unitCode: '796', unitName: 'шт',
      priceNoVat: l.priceNoVat, sumNoVat: l.sumNoVat, vatRate: l.vatRate, vat: l.vat, sumIncVat: l.sumIncVat,
    })),
    totals,
  }
}

// Черновик: номера ещё нет — печатается «б/н», чтобы бумагу нельзя было принять за документ.
export function draftUpdView(order: InvoiceOrder, req: InvoiceRequisites, buyerName: string, docDate: string): UpdView {
  return { ...buildUpdBody(order, req, buyerName, docDate), number: 'б/н', docDate }
}

export function issuedUpdView(row: UpdIssued): UpdView {
  return { ...row.snapshot, number: String(row.number), docDate: row.doc_date }
}

// Что мешает выдать УПД. Счёт-фактура без ИНН покупателя не даёт ему вычет НДС.
export function updIssueBlockers(body: UpdBody): string[] {
  const out: string[] = []
  if (!body.buyer.name) out.push('нет наименования покупателя')
  if (!body.buyer.inn) out.push('нет ИНН покупателя')
  if (!body.lines.length) out.push('в заказе нет позиций')
  else if (!(body.totals.sumIncVat > 0)) out.push('сумма заказа нулевая')
  return out
}

// Следующий номер серии — тот же расчёт, что в issue_upd (supabase/migrations/20261007_upd_registry.sql).
export function nextUpdNumber(startNumber: number, lastNumber: number | null): number {
  return Math.max(lastNumber ?? 0, startNumber - 1) + 1
}

export const moscowDate = (d: Date | string = new Date()) =>
  new Date(d).toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' })

// Дату выбирает тот, кто выдаёт: отметки «Отгружен» ставят пачкой и поздно, реальная дата
// отгрузки в подписанных УПД не совпала ни с одной отметкой (сверка 07.10).
export function updDateError(docDate: string, createdAt: string, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(docDate) || Number.isNaN(Date.parse(`${docDate}T00:00:00Z`))) return 'дата в формате ГГГГ-ММ-ДД'
  if (docDate < moscowDate(createdAt)) return 'дата раньше создания заказа'
  const max = new Date(Date.parse(`${today}T00:00:00Z`) + 30 * 86400e3).toISOString().slice(0, 10)
  if (docDate > max) return 'дата дальше месяца вперёд'
  return null
}
