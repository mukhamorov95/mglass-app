// Строка выписки ↔ неоплаченный счёт. Чистые функции: и сервер (автоподбор), и
// вкладка «Выписка» (ручной выбор с поиском) считают одинаково.
// Сравниваем с ОСТАТКОМ по платежам, а не с суммой счёта: вторая половина оплаты
// равна остатку, а не счёту, и до правки не находилась вовсе.

export type OpenInvoice = {
  id: number
  no: string
  payer: string | null
  inn: string | null
  amount: number
  paid: number
  remainder: number
  orders: number[]
  issued_at: string | null
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
const round2 = (v: number) => Math.round(v * 100) / 100

export function rowEffect(remainder: number, amount: number): RowEffect {
  const rest = round2(remainder - amount)
  return { partial: rest > TOL, over: rest < -TOL ? round2(-rest) : 0, rest: Math.max(0, rest) }
}

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function invoiceNoIn(no: string, purpose: string | null): boolean {
  if (!no || no === '—' || !purpose) return false
  return new RegExp(`(^|\\D)${escRe(no)}(\\D|$)`).test(purpose)
}

export type InvoiceMatch = { invoice: OpenInvoice } & RowEffect

// ИНН или номер счёта — сильные признаки; одна лишь сумма — слабый, но с ними складывается.
// Сумма больше остатка — не автоподбор: это либо другой счёт, либо оплата нескольких сразу,
// пусть решит человек.
export function matchInvoice(row: BankIn, invoices: OpenInvoice[]): InvoiceMatch | null {
  const amount = Number(row.amount)
  const scored = invoices.flatMap(i => {
    if (i.remainder <= TOL || amount > i.remainder + TOL) return []
    const sameAmount = Math.abs(i.remainder - amount) < TOL
    const sameInn = !!row.inn && !!i.inn && i.inn === row.inn
    const noInPurpose = invoiceNoIn(i.no, row.purpose)
    const ok = (sameInn && (sameAmount || noInPurpose)) || (noInPurpose && sameAmount)
    return ok ? [{ i, noInPurpose }] : []
  })
  let pick = scored.length === 1 ? scored[0].i : null
  if (!pick && scored.length > 1) {
    const byNo = scored.filter(s => s.noInPurpose)
    if (byNo.length === 1) pick = byNo[0].i
  }
  return pick ? { invoice: pick, ...rowEffect(pick.remainder, amount) } : null
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
