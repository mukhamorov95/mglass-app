// Строка выписки ↔ неоплаченный счёт. Чистые функции: и сервер (автоподбор), и
// вкладка «Выписка» (ручной выбор с поиском) считают одинаково.
// Сравниваем с ОСТАТКОМ по платежам, а не с суммой счёта: вторая половина оплаты
// равна остатку, а не счёту, и до правки не находилась вовсе. Остаток — по деньгам
// (выписка, наличные): ручное «Оплачен» деньгами не считается, его подтверждает банк.

export type OpenInvoice = {
  id: number
  no: string
  payer: string | null
  inn: string | null
  amount: number
  paid: number
  remainder: number
  // Сколько закрыто отметкой «Оплачен» без денег в банке — пришедший перевод её заменит
  marked?: number
  // Сколько не пришло по ТЕКУЩИМ итогам заказов счёта. Счёт выставлен до правки заказа и
  // устарел (05557: в счёте 37 259, заказ и оплата 37 120) — клиент платит итог заказа.
  orderRemainder?: number
  orders: number[]
  issued_at: string | null
}

// Заказ без счёта в приложении: клиент платит «по счёт-спецификации 05317» — номер заказа.
export type OpenOrder = {
  id: number
  no: string
  payer: string | null
  total: number
  remainder: number
  marked: number
}

export type BankIn = { amount: number; inn: string | null; purpose: string | null }

export type RowEffect = {
  // Строка меньше остатка — частичная оплата: счёт остаётся неоплаченным
  partial: boolean
  // Строка больше остатка — переплата (деньги записываются, бухгалтер видит предупреждение)
  over: number
  rest: number
}

const TOL = 0.5
// Счёт и итог заказа расходятся на рубли округления (05599: счёт 17 433, оплатили итог 17 440)
const SLACK = 10
const round2 = (v: number) => Math.round(v * 100) / 100

export function rowEffect(remainder: number, amount: number): RowEffect {
  const rest = round2(remainder - amount)
  return { partial: rest > TOL, over: rest < -TOL ? round2(-rest) : 0, rest: Math.max(0, rest) }
}

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Тире любое: в приложении сводный счёт «05167–05400», клиент пишет «05167-05400».
const dashes = (s: string) => s.replace(/[‐‑‒–—−]/g, '-')

export function invoiceNoIn(no: string, purpose: string | null): boolean {
  if (!no || no === '—' || !purpose) return false
  return new RegExp(`(^|\\D)${escRe(dashes(no))}(\\D|$)`).test(dashes(purpose))
}

export const orderNo = (id: number) => String(id).padStart(5, '0')

// Номера заказов из назначения: 05317, 05167-05400 → [5317] / [5167, 5400]
export function orderIdsIn(purpose: string | null): number[] {
  const out = new Set<number>()
  for (const m of (purpose ?? '').matchAll(/(?<!\d)(0\d{4})(?!\d)/g)) out.add(Number(m[1]))
  return [...out]
}

// strong — номер счёта в назначении и сумма сошлись, и номер не случайный: ИНН совпал или
// номер длинный (05569 в сумме или дате не встречается). Такой строке оплата проставляется
// без человека; остальные подобранные — подсказка бухгалтеру. ИНН есть у трети клиентов.
// byOrder — сумма сошлась с итогом заказа, а не с устаревшим счётом.
export type InvoiceMatch = { invoice: OpenInvoice; strong: boolean; byOrder: boolean } & RowEffect

// ИНН или номер счёта — сильные признаки; одна лишь сумма — слабый, но с ними складывается.
// Сумма больше остатка — не автоподбор: это либо другой счёт, либо оплата нескольких сразу,
// пусть решит человек.
export function matchInvoice(row: BankIn, invoices: OpenInvoice[]): InvoiceMatch | null {
  const amount = Number(row.amount)
  const scored = invoices.flatMap(i => {
    const byOrder = i.orderRemainder != null && i.orderRemainder > TOL && Math.abs(i.orderRemainder - amount) <= SLACK
    if (i.remainder <= TOL && !byOrder) return []
    if (amount > i.remainder + SLACK && !byOrder) return []
    const sameAmount = Math.abs(i.remainder - amount) <= SLACK || byOrder
    const sameInn = !!row.inn && !!i.inn && i.inn === row.inn
    const noInPurpose = invoiceNoIn(i.no, row.purpose)
    const ok = (sameInn && (sameAmount || noInPurpose)) || (noInPurpose && sameAmount)
    const strong = noInPurpose && sameAmount && (sameInn || i.no.replace(/\D/g, '').length >= 5)
    const due = byOrder && Math.abs(i.remainder - amount) > SLACK ? i.orderRemainder! : i.remainder
    return ok ? [{ i, noInPurpose, strong, byOrder: due !== i.remainder, due }] : []
  })
  let pick = scored.length === 1 ? scored[0] : null
  if (!pick && scored.length > 1) {
    const byNo = scored.filter(s => s.noInPurpose)
    if (byNo.length === 1) pick = byNo[0]
  }
  return pick ? { invoice: pick.i, strong: pick.strong, byOrder: pick.byOrder, ...rowEffect(pick.due, amount) } : null
}

// Заказ без счёта: только уверенно — номер заказа в назначении и сумма = остатку по деньгам.
export function matchOrder(row: BankIn, orders: OpenOrder[]): (RowEffect & { order: OpenOrder }) | null {
  const amount = Number(row.amount)
  const hits = orders.filter(o => o.remainder > TOL && Math.abs(o.remainder - amount) <= SLACK && invoiceNoIn(o.no, row.purpose))
  return hits.length === 1 ? { order: hits[0], ...rowEffect(hits[0].remainder, amount) } : null
}

const digits = (s: string) => s.replace(/\D/g, '')

// Поиск для ручного выбора: номер, плательщик, ИНН или сумма (остаток/счёт). Без запроса —
// сначала счета, чей остаток ближе к сумме строки.
export function searchInvoices(list: OpenInvoice[], q: string, rowAmount: number, limit = 12): OpenInvoice[] {
  const t = q.trim().toLowerCase()
  const d = digits(t)
  const hits = !t ? list : list.filter(i =>
    i.no.toLowerCase().includes(t)
    || (i.payer ?? '').toLowerCase().includes(t)
    || (!!d && d.length >= 3 && (
      (i.inn ?? '').includes(d)
      || digits(String(Math.round(i.remainder))).startsWith(d)
      || digits(String(Math.round(i.amount))).startsWith(d)
    )))
  return [...hits]
    .sort((a, b) => Math.abs(a.remainder - rowAmount) - Math.abs(b.remainder - rowAmount) || b.id - a.id)
    .slice(0, limit)
}
