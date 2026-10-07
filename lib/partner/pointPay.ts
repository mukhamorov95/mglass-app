// Точка на рынке платит 100 % до запуска (решение владельца 01.10, Т6). Что ей видно
// до запуска — состояние в кабинете, а не сообщение.
//
// «Менеджер подтвердил сумму» = по заказу выставлен счёт: строка в реестре счетов
// `invoices` (её создаёт печать счёта менеджером, /api/invoices, один счёт на набор
// заказов). До этого сумма ещё может поменяться — пересчёт, договорная цена.

export type PointStage = 'check' | 'await_payment' | 'paid'

export function pointStage(o: {
  isPoint: boolean
  launched: boolean
  submitted: boolean   // партнёр отправил просчёт в работу
  invoiced: boolean
  paid: boolean
}): PointStage | null {
  if (!o.isPoint || o.launched) return null
  if (!o.submitted && !o.invoiced) return null
  if (o.paid) return 'paid'
  return o.invoiced ? 'await_payment' : 'check'
}

export const POINT_LINE: Record<PointStage, string> = {
  check: 'Менеджер проверяет сумму — затем счёт на оплату',
  await_payment: 'Ждём вашей оплаты',
  paid: 'Оплата получена — запускаем в работу',
}
