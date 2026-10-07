// Строки и итоги УПД (статус 1 — счёт-фактура и передаточный документ, ПП 1137).
// Чистые функции ради тестов: форма печатается и менеджеру, и в кабинете партнёра.
//
// До 07.10 УПД датировался запуском заказа (304 из 304 за 60 дней), цена за единицу
// печаталась с НДС, а НДС итога считался от итога, а не складывался из строк.

import { computeInvoiceTotals, type InvoiceOrder } from '@/lib/b2b/invoiceMath'

export type UpdLine = {
  qty: number
  priceNoVat: number
  sumNoVat: number
  vatRate: number
  vat: number
  sumIncVat: number
}

export type UpdTotals = { sumNoVat: number; vat: number; sumIncVat: number }

const r2 = (n: number) => Math.round(n * 100) / 100

// НДС 22 % — с 01.01.2026; отгрузка раньше — 20 %. Ставка — по дате отгрузки.
export function updVatRate(docDate: string): number {
  return docDate.slice(0, 10) < '2026-01-01' ? 20 : 22
}

export function updLines(order: InvoiceOrder, docDate: string): { lines: UpdLine[]; totals: UpdTotals } {
  const { items, lineSums } = computeInvoiceTotals(order)
  const vatRate = updVatRate(docDate)
  const lines = items.map((it, i) => {
    const qty = Number(it.quantity) || 1
    const sumIncVat = lineSums[i]
    const vat = r2(sumIncVat * vatRate / (100 + vatRate))
    const sumNoVat = r2(sumIncVat - vat)
    return { qty, priceNoVat: r2(sumNoVat / qty), sumNoVat, vatRate, vat, sumIncVat }
  })
  // Итоги — суммы строк: так сходятся графы 5, 8 и 9 до копейки.
  const totals = {
    sumNoVat: r2(lines.reduce((s, l) => s + l.sumNoVat, 0)),
    vat: r2(lines.reduce((s, l) => s + l.vat, 0)),
    sumIncVat: r2(lines.reduce((s, l) => s + l.sumIncVat, 0)),
  }
  return { lines, totals }
}

export type UpdDateSource = 'shipped' | 'launched' | 'created'

// Дата УПД — дата отгрузки. Отметка «Отгружен» (stages.shipped) — её ставят цех,
// отгрузка и «Отметить месяц отгруженным»; shipped_date пишет только блок логистики.
export function updDocDate(notes: Record<string, unknown>, createdAt: string): { date: string; source: UpdDateSource } {
  const stages = (notes.stages ?? {}) as Record<string, unknown>
  const shipped = (typeof stages.shipped === 'string' && stages.shipped) || (typeof notes.shipped_date === 'string' && notes.shipped_date)
  if (shipped) return { date: shipped, source: 'shipped' }
  if (typeof notes.launched_at === 'string' && notes.launched_at) return { date: notes.launched_at, source: 'launched' }
  return { date: createdAt, source: 'created' }
}
