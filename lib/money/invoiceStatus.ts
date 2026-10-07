import { remainderStatus } from '@/lib/b2b/orderPayments'
import { VAT } from '@/lib/b2bCalculator'

// Статус счёта — производная от payments, а не ручной флажок invoices.status.
// Чей платёж:
//   • с invoice_id — только этого счёта (мульти-заказный счёт якорится так);
//   • без invoice_id, с b2b_order_id — каждого счёта, где есть этот заказ
//     (одно-заказный счёт и ручное «Оплачен» по заказу якорятся заказом).
// Каждый платёж считается одному счёту один раз; войднутые не считаются.
// Интерпретация остатка — remainderStatus из lib/b2b/orderPayments (A23), вторую не пишем.

export type InvoiceLike = {
  id: number
  amount: number | null
  order_ids: number[] | null
  status?: string | null
}

export type PaymentLike = {
  id?: number
  amount: number
  invoice_id: number | null
  b2b_order_id: number | null
  voided_at?: string | null
  paid_at?: string | null
  external_key?: string | null
  source?: string | null
}

export type InvoicePayState = 'paid' | 'partial' | 'unpaid'

export type InvoicePayment = {
  paid: number
  remainder: number
  derivedStatus: InvoicePayState
  lastPaidAt: string | null
}

export const INVOICE_STATE_LABEL: Record<InvoicePayState | 'cancelled', string> = {
  paid: 'оплачен',
  partial: 'частично',
  unpaid: 'ждёт оплаты',
  cancelled: 'отменён',
}

export function payState(amount: number, paid: number): Omit<InvoicePayment, 'lastPaidAt'> {
  const rem = remainderStatus(amount, paid)
  // Ноль платежей — «ждёт оплаты», не «долг»: выписка могла ещё не дойти.
  const derivedStatus: InvoicePayState =
    rem.hasPayment && !rem.outstanding ? 'paid'
    : rem.hasPayment ? 'partial'
    : 'unpaid'
  return { paid: rem.paid, remainder: Math.max(0, rem.remainder), derivedStatus }
}

// Оплата по каждому счёту из общего списка платежей (одним проходом).
export function invoicePayments(invoices: InvoiceLike[], payments: PaymentLike[]): Map<number, InvoicePayment> {
  const invIds = new Set(invoices.map(i => i.id))
  const invByOrder = new Map<number, number[]>()
  for (const inv of invoices) {
    for (const oid of inv.order_ids ?? []) {
      const list = invByOrder.get(Number(oid)) ?? []
      list.push(inv.id)
      invByOrder.set(Number(oid), list)
    }
  }

  const paid = new Map<number, number>()
  const last = new Map<number, string>()
  const seen = new Set<string>()
  const add = (invId: number, p: PaymentLike) => {
    // Один и тот же платёж мог прийти дважды (прочитан и по счёту, и по заказу).
    const key = p.id != null ? `${p.id}|${invId}` : null
    if (key) { if (seen.has(key)) return; seen.add(key) }
    paid.set(invId, (paid.get(invId) ?? 0) + (Number(p.amount) || 0))
    const d = p.paid_at ?? null
    if (d && (!last.has(invId) || d > last.get(invId)!)) last.set(invId, d)
  }

  for (const p of payments) {
    if (p.voided_at) continue
    if (!(Number(p.amount) > 0)) continue
    if (p.invoice_id != null) {
      const id = Number(p.invoice_id)
      if (invIds.has(id)) add(id, p)
      continue
    }
    if (p.b2b_order_id != null) {
      for (const id of invByOrder.get(Number(p.b2b_order_id)) ?? []) add(id, p)
    }
  }

  const out = new Map<number, InvoicePayment>()
  for (const inv of invoices) {
    out.set(inv.id, { ...payState(Number(inv.amount) || 0, paid.get(inv.id) ?? 0), lastPaidAt: last.get(inv.id) ?? null })
  }
  return out
}

export function invoicePayment(inv: InvoiceLike, payments: PaymentLike[]): InvoicePayment {
  return invoicePayments([inv], payments).get(inv.id)!
}

// Колонка invoices.status, согласованная с платежами. null — менять нечего.
// Отменённый счёт не трогаем: отмена — решение человека, не производная денег.
export function columnStatusFor(current: string | null | undefined, derived: InvoicePayState): 'paid' | 'issued' | null {
  if (current === 'cancelled') return null
  if (derived === 'paid') return current === 'paid' ? null : 'paid'
  return current === 'paid' ? 'issued' : null
}

// Вид ручного платежа: закрыл остаток целиком — «полная» или «остаток», иначе — предоплата.
export function manualPaymentKind(paidBefore: number, amount: number, remainder: number): 'full' | 'remainder' | 'prepayment' {
  if (amount + 1 < remainder) return 'prepayment'
  return paidBefore > 0 ? 'remainder' : 'full'
}

// Проверка суммы ручного платежа до записи: деньги, которых не было, не пишем.
export function checkManualAmount(raw: unknown, remainder: number): { ok: true; amount: number } | { ok: false; error: string } {
  const amount = Math.round(Number(String(raw ?? '').replace(/\s/g, '').replace(',', '.')) * 100) / 100
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'Сумма платежа должна быть больше нуля' }
  if (remainder <= 0) return { ok: false, error: 'Счёт уже оплачен по платежам' }
  if (amount > remainder + 1) {
    return { ok: false, error: `Сумма ${fmtRub(amount)} больше остатка ${fmtRub(remainder)} — переплату так не записать` }
  }
  return { ok: true, amount }
}

// НДС в сумме счёта (сумма с НДС) — до копейки.
export function invoiceVat(amount: number): number {
  return Math.round((Number(amount) || 0) * VAT / (100 + VAT) * 100) / 100
}

export function fmtRub(n: number): string {
  return Math.round(n).toLocaleString('ru-RU') + ' ₽'
}
