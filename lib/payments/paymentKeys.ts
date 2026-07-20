// Чистая логика денежного ядра: канонические ключи идемпотентности и сборка
// строки платежа. Без Supabase и React — покрыто юнит-тестами.
// Ключ канонизируется на БИЗНЕС-ДОКУМЕНТЕ, не на точке ввода: три разных
// экрана отметки одной оплаты дают один external_key → одну строку.

export type PaymentKind = 'prepayment' | 'remainder' | 'full' | 'refund' | 'adjustment'
export type PaymentMethod = 'Счёт' | 'Наличные' | 'Карта' | 'Перевод' | 'Другое'

export type PaymentInput = {
  externalKey: string
  amount: number
  paidAt: string                    // 'YYYY-MM-DD'
  kind: PaymentKind
  source: string
  method?: PaymentMethod
  b2bOrderId?: number | null
  orderId?: string | null           // uuid розничного заказа
  crmSaleId?: number | null
  enteredBy?: string | null         // uuid users
  enteredByName?: string | null
  note?: string | null
  importBatch?: string | null
}

export const b2bPaymentKey = (b2bOrderId: number, part: 'prepayment' | 'settlement') =>
  `b2b:${b2bOrderId}:${part}`

export const orderPaymentKey = (orderId: string, part: 'prepayment' | 'settlement') =>
  `order:${orderId}:${part}`

// Галочки в ведомости: при связанном заказе ключ — ключ ЗАКАЗА (дубля не будет),
// иначе — собственный ключ продажи (сделка AmoCRM без внутреннего заказа).
export function salePaymentKey(
  sale: { id: number; b2b_order_id?: number | null; order_id?: string | null },
  part: 'prepayment' | 'remainder',
): string {
  const docPart = part === 'prepayment' ? 'prepayment' : 'settlement'
  if (sale.b2b_order_id) return b2bPaymentKey(sale.b2b_order_id, docPart)
  if (sale.order_id) return orderPaymentKey(sale.order_id, docPart)
  return `sale:${sale.id}:${part}`
}

export const planPaymentKey = (plannedPaymentId: number) => `plan:${plannedPaymentId}`
export const manualPaymentKey = (uuid: string) => `manual:${uuid}`
export const gsheetPaymentKey = (orderNo: string) => `gsheet:${orderNo.trim()}`

export function buildPaymentRow(input: PaymentInput) {
  if (!(input.amount > 0)) throw new Error(`Платёж должен быть > 0, получено: ${input.amount}`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.paidAt)) throw new Error(`paid_at не дата: ${input.paidAt}`)
  if (!input.b2bOrderId && !input.orderId && !input.crmSaleId) {
    throw new Error('Платёж без документа: нужна хотя бы одна ссылка (b2b/розница/продажа)')
  }
  return {
    external_key: input.externalKey,
    amount: Math.round(input.amount * 100) / 100,
    paid_at: input.paidAt,
    kind: input.kind,
    method: input.method ?? 'Счёт',
    source: input.source,
    b2b_order_id: input.b2bOrderId ?? null,
    order_id: input.orderId ?? null,
    crm_sale_id: input.crmSaleId ?? null,
    entered_by: input.enteredBy ?? null,
    entered_by_name: input.enteredByName ?? null,
    note: input.note ?? null,
    import_batch: input.importBatch ?? null,
    voided_at: null,                 // повторная отметка после снятия снимает void
    updated_at: new Date().toISOString(),
  }
}
