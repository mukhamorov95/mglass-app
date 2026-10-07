import { remainderStatus } from '@/lib/b2b/orderPayments'

export type OrderPayStatus = 'paid' | 'partial' | 'unpaid' | 'unknown'

// Оплата заказа в списке — из payments (этап 1 docs/SYSTEM_ORDER_ROUTE.md), а не из флажков
// notes: флажок invoice_paid ставит только ручная кнопка, платёж по счёту его не трогает.
// paid === undefined — платежи не загрузились; 'unpaid' — платежей нет (оплата не заведена).
// Рубль разницы — округление долей счёта, не долг.
export function payStatusFromPayments(total: number, paid: number | undefined): OrderPayStatus {
  if (paid === undefined) return 'unknown'
  const r = remainderStatus(total, paid)
  if (!r.hasPayment) return 'unpaid'
  return r.remainder <= 1 ? 'paid' : 'partial'
}
