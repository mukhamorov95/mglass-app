// «Оплачен», поставленный человеком (кнопка заказа, отметка по счёту) или ночной сверкой
// из этой кнопки, — утверждение, что деньги пришли, а не сами деньги. Перевод из выписки —
// факт: пришёл — заменяет отметку, иначе одни и те же деньги считались бы дважды.
// Наличные и карту выписка расчётного счёта не видит — такие отметки не заменяем.

const MARK_SOURCES = new Set(['b2b_order', 'reconcile', 'invoice_manual'])
const TRANSFER_METHODS = new Set(['Счёт', 'Перевод'])

export function isTransferMark(p: { source?: string | null; method?: string | null }): boolean {
  return MARK_SOURCES.has(p.source ?? '') && (p.method == null || TRANSFER_METHODS.has(p.method))
}

// Списание с аванса клиента (lib/accounting/clientAdvance.ts) — деньги, но не за этот заказ
// именно: пришёл перевод за счёт — он важнее, а списание уходит обратно в остаток аванса при
// пересчёте. Поэтому остаток счёта для выписки считается без списаний, но они не снимаются.
export const ADVANCE_SOURCE = 'client_advance'
export function isAdvanceAllocation(p: { source?: string | null }): boolean {
  return p.source === ADVANCE_SOURCE
}
