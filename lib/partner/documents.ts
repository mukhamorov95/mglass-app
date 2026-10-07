// Документы заказа в кабинете: КП · счёт · УПД.

// open — счёт-спецификацию можно открыть в кабинете;
// manager — заказ в работе, счёт присылает менеджер (самообслуживание не включено);
// after_launch — счёт появится после запуска заказа.
export type InvoiceState = 'open' | 'manager' | 'after_launch'

export function invoiceState(o: { launched: boolean; canSelfInvoice: boolean }): InvoiceState {
  if (!o.launched) return 'after_launch'
  return o.canSelfInvoice ? 'open' : 'manager'
}

export const INVOICE_HINT: Record<Exclude<InvoiceState, 'open'>, string> = {
  manager: 'счёт пришлёт менеджер',
  after_launch: 'счёт — после запуска',
}

export type UpdShort = { number: number; year: number; docDate: string }
