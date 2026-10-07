// Документы заказа в кабинете: КП · счёт · УПД.

// open — счёт-спецификацию можно открыть в кабинете;
// manager — заказ в работе, счёт присылает менеджер (самообслуживание не включено);
// after_launch — счёт появится после запуска заказа;
// after_check — точка: счёт откроется, когда менеджер выставит его (подтвердит сумму).
export type InvoiceState = 'open' | 'manager' | 'after_launch' | 'after_check'

export function invoiceState(o: { launched: boolean; canSelfInvoice: boolean; isPoint?: boolean; invoiced?: boolean }): InvoiceState {
  // Точка платит до запуска — значит, счёт ей нужен до запуска, как только он выставлен.
  if (o.isPoint && o.invoiced) return 'open'
  if (!o.launched) return o.isPoint ? 'after_check' : 'after_launch'
  return o.canSelfInvoice ? 'open' : 'manager'
}

export const INVOICE_HINT: Record<Exclude<InvoiceState, 'open'>, string> = {
  manager: 'счёт пришлёт менеджер',
  after_launch: 'счёт — после запуска',
  after_check: 'счёт — после проверки суммы',
}

// Отказ маршрута счёта словами — тот же, что видит партнёр на странице счёта.
export const INVOICE_REFUSAL: Record<Exclude<InvoiceState, 'open'>, { status: number; error: string }> = {
  manager: { status: 403, error: 'Счёт выставляет менеджер' },
  after_launch: { status: 409, error: 'Счёт доступен после запуска заказа в работу' },
  after_check: { status: 409, error: 'Счёт откроется, когда менеджер проверит сумму и выставит его' },
}

export type UpdShort = { number: number; year: number; docDate: string }
