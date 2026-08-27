// A23: оплата и остаток заказа — из payments, НЕ из notes (notes для денег больше
// не источник правды). Платёж засчитывается заказу двумя путями:
//   • напрямую — payments.b2b_order_id = заказ;
//   • через счёт — payments.invoice_id → invoices.order_ids содержит заказ. Оплата
//     мульти-заказного счёта раскладывается на заказы пропорционально их сумме.
// Войднутые платежи (voided_at) не считаются.

export type PaymentRow = {
  amount: number
  b2b_order_id: number | null
  invoice_id: number | null
  voided_at: string | null
}

export type InvoiceRow = {
  id: number
  order_ids: number[] | null
  amount: number | null
}

// Сколько оплачено по каждому заказу. orderTotals нужны для раскладки счёта по долям.
export function paidByOrder(
  payments: PaymentRow[],
  invoices: InvoiceRow[],
  orderTotals: Map<number, number>,
): Map<number, number> {
  const paid = new Map<number, number>()
  const add = (orderId: number, amt: number) => {
    if (!Number.isFinite(amt) || amt === 0) return
    paid.set(orderId, (paid.get(orderId) ?? 0) + amt)
  }

  const invById = new Map<number, InvoiceRow>()
  for (const inv of invoices) invById.set(inv.id, inv)

  for (const p of payments) {
    if (p.voided_at) continue
    const amt = Number(p.amount) || 0
    if (amt === 0) continue

    // Прямой платёж по заказу — приоритетнее, однозначная привязка.
    if (p.b2b_order_id != null) { add(Number(p.b2b_order_id), amt); continue }

    // Платёж по счёту — раскладываем на заказы счёта пропорционально их сумме.
    if (p.invoice_id != null) {
      const inv = invById.get(Number(p.invoice_id))
      const ids = Array.isArray(inv?.order_ids) ? inv!.order_ids.map(Number).filter(Boolean) : []
      if (ids.length === 0) continue
      const weights = ids.map(id => Math.max(0, orderTotals.get(id) ?? 0))
      const wsum = weights.reduce((s, w) => s + w, 0)
      if (wsum > 0) {
        ids.forEach((id, i) => add(id, amt * weights[i] / wsum))
      } else {
        // суммы заказов неизвестны — делим поровну, чтобы деньги не потерялись
        ids.forEach(id => add(id, amt / ids.length))
      }
    }
  }
  return paid
}

export type RemainderStatus = {
  total: number
  paid: number
  remainder: number
  hasPayment: boolean   // по заказу есть хоть один платёж — иначе «нет данных», не «долг»
  outstanding: boolean  // частичная оплата: 0 < paid < total. Только это = реальный остаток
  overpaid: boolean
}

// Порог, ниже которого остаток считаем копеечным и не тревожим (округление раскладки).
const EPS = 1

export function remainderStatus(total: number, paid: number): RemainderStatus {
  const t = Math.round(Number(total) || 0)
  const p = Math.round(Number(paid) || 0)
  const remainder = t - p
  const hasPayment = p > 0
  return {
    total: t,
    paid: p,
    remainder,
    hasPayment,
    // Долг показываем ТОЛЬКО когда есть частичная оплата. Ноль платежей — это
    // «оплата не заведена» (банковский импорт ещё не сделан), а не долг: молчим.
    outstanding: hasPayment && remainder > EPS,
    overpaid: remainder < -EPS,
  }
}
