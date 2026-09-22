// Знак операции ДДС относительно своего фонда. У «Поступлений» (класс income)
// естественное направление — приход, у всех остальных фондов — расход. Операция
// против направления вычитается: возврат клиенту уменьшает поступления, а возврат от
// поставщика, полученный кредит или сторно из книги (импорт записал минус книги как
// перевёрнутый kind) уменьшают расход фонда. До 22.09.2026 экраны складывали amount,
// не глядя на kind: ООО за 08.2026 показывало поступления на 61 804 ₽ больше.

export type SignedEntry = { kind: string; amount: number | string; fund_id: number; subfund_id?: number | null }
export type FundClassRef = { id: number; fund_class: string }

export const naturalKind = (fundClass: string): 'in' | 'out' => (fundClass === 'income' ? 'in' : 'out')

export function signedAmount(e: { kind: string; amount: number | string }, fundClass: string): number {
  const v = Number(e.amount) || 0
  return e.kind === naturalKind(fundClass) ? v : -v
}

// Суммы по фондам и подфондам с учётом знака. Операция фонда, которого нет в списке,
// пропускается: без класса фонда её знак неизвестен.
export function signedSums(entries: SignedEntry[], funds: FundClassRef[]) {
  const cls = new Map(funds.map(f => [Number(f.id), f.fund_class]))
  const byFund = new Map<number, number>()
  const bySub = new Map<number, number>()
  for (const e of entries) {
    const c = cls.get(Number(e.fund_id))
    if (c == null) continue
    const v = signedAmount(e, c)
    byFund.set(Number(e.fund_id), (byFund.get(Number(e.fund_id)) ?? 0) + v)
    if (e.subfund_id != null) bySub.set(Number(e.subfund_id), (bySub.get(Number(e.subfund_id)) ?? 0) + v)
  }
  return { byFund, bySub }
}

// Поступления: знаковая сумма фондов класса income. Приход на расходный фонд
// (кредит, возврат от поставщика) сюда не попадает — это не выручка.
export function incomeOf(entries: SignedEntry[], funds: FundClassRef[]): number {
  const { byFund } = signedSums(entries, funds.filter(f => f.fund_class === 'income'))
  return [...byFund.values()].reduce((s, v) => s + v, 0)
}

// Доля части от базы в процентах; null, когда база не положительна — доля от нуля
// или от убытка ничего не говорит.
export function share(part: number, base: number): number | null {
  return base > 0 ? (part / base) * 100 : null
}
