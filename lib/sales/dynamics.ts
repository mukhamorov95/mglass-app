// Динамика продаж по месяцам: год против прошлого (владелец 22.10.2026). Один расчёт для
// двух контуров — M-Glass (книга продаж crm_sales) и B2B (заказы b2b_orders). Деньги —
// поступления ДДС: ИП для M-Glass, ООО для B2B, без переводов «со своих» и возвратов.

export type Contour = 'mglass' | 'b2b'
export type DatedAmount = { date: string; amount: number }   // date — день по Москве, YYYY-MM-DD

// Книга ДДС из Google-листов закончилась 25.08.2026, дальше деньги — только из выписок
// банка. Месяцы после последней выписки — «нет данных», а не ноль.
export const BOOK_END = '2026-08-25'

export type YearSeries = { sales: number[]; count: number[]; money: (number | null)[] | null }
export type Totals = { sales: number; count: number; avg: number }

const months12 = () => Array.from({ length: 12 }, () => 0)
const yearOf = (date: string) => Number(date.slice(0, 4))
const monthOf = (date: string) => Number(date.slice(5, 7)) - 1

export function byMonth(rows: DatedAmount[], year: number): { sales: number[]; count: number[] } {
  const sales = months12(), count = months12()
  for (const r of rows) {
    if (yearOf(r.date) !== year) continue
    const m = monthOf(r.date)
    sales[m] += r.amount || 0
    count[m] += 1
  }
  return { sales: sales.map(Math.round), count }
}

// Деньги за месяц известны, если месяц не позже последнего покрытого дня (coveredTo).
export function moneyByMonth(rows: DatedAmount[], year: number, coveredTo: string): (number | null)[] {
  const sums = months12()
  for (const r of rows) if (yearOf(r.date) === year && r.date <= coveredTo) sums[monthOf(r.date)] += r.amount || 0
  const lastY = yearOf(coveredTo), lastM = monthOf(coveredTo)
  return sums.map((s, m) => (year < lastY || (year === lastY && m <= lastM) ? Math.round(s) : null))
}

// С 1 января по день cutoff («MM-DD») включительно — одинаковое окно для обоих лет.
export function totalsTo(rows: DatedAmount[], year: number, cutoff: string): Totals {
  let sales = 0, count = 0
  for (const r of rows) {
    if (yearOf(r.date) !== year || r.date.slice(5) > cutoff) continue
    sales += r.amount || 0
    count += 1
  }
  return { sales: Math.round(sales), count, avg: count ? Math.round(sales / count) : 0 }
}

export function sumTo(rows: DatedAmount[], year: number, cutoff: string): number {
  return Math.round(rows.reduce((s, r) => s + (yearOf(r.date) === year && r.date.slice(5) <= cutoff ? r.amount || 0 : 0), 0))
}

// Изменение к прошлому году, %; нет базы — null (а не бесконечность).
export function deltaPct(cur: number, prev: number): number | null {
  if (!prev) return null
  return Math.round((cur / prev - 1) * 1000) / 10
}

// Последний день, за который деньги контура известны: книга до BOOK_END, дальше — выписка.
export function moneyCoveredTo(lastStatementDay: string | null): string {
  return lastStatementDay && lastStatementDay > BOOK_END ? lastStatementDay : BOOK_END
}

// В приход ДДС попадают и переводы между своими счетами, и возвраты — это не деньги клиентов.
export function isClientIncome(subfundName: string | null | undefined): boolean {
  return !/со своих|возврат/i.test(subfundName ?? '')
}

// Статус B2B-заказа лежит в notes (JSON текстом). Просчёты и черновики — не продажи.
const NOT_SALE = new Set(['quote', 'pending_approval', 'rejected'])
export function isB2BSale(notes: unknown): boolean {
  let n: unknown = notes
  if (typeof notes === 'string') { try { n = JSON.parse(notes) } catch { return true } }
  const st = n && typeof n === 'object' ? (n as { status?: unknown }).status : undefined
  return !(typeof st === 'string' && NOT_SALE.has(st))
}
