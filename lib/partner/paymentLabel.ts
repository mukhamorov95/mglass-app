import type { PaymentView } from '@/lib/partner/orderMoney'

const rub = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'

// Одна подпись оплаты для списка и карточки кабинета.
export function paymentLabel(v: PaymentView): string {
  if (v.status === 'paid') return 'Оплачен'
  if (v.status === 'own_cost') return 'За наш счёт — к оплате не выставляется'
  if (v.status === 'partial') return `Оплачено ${rub(v.paid)} из ${rub(v.total)}, осталось ${rub(v.remainder)}`
  return 'Ожидает оплаты'
}

export const paymentPill = (v: PaymentView) => (v.status === 'paid' || v.status === 'own_cost' ? 'p-ready' : 'p-sub')

// Сколько ещё к оплате по заказу: у переделки за наш счёт и оплаченного — ноль.
export function unpaidOf(v: PaymentView | null | undefined): number {
  if (!v) return 0
  if (v.status === 'awaiting') return v.total
  if (v.status === 'partial') return v.remainder
  return 0
}
