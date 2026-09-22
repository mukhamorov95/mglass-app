import { describe, it, expect } from 'vitest'
import { signedAmount, signedSums, incomeOf, share } from '@/lib/accounting/fundSign'
import { finWeeksOfMonth, fundAvailability, weekIncome, type FundLike } from '@/lib/finweek'

// Справочники как в базе: ИП — «Поступления» id 1, «Сдельная» 2, «Кредиты» 8, оклады 16;
// ООО — «Поступления» id 18 (подфонды 94 наличные, 95 Альфа, 97 возвраты).
const OOO_FUNDS = [{ id: 18, fund_class: 'income' }]
const IP_FUNDS = [
  { id: 1, fund_class: 'income' }, { id: 2, fund_class: 'variable' },
  { id: 8, fund_class: 'fund' }, { id: 16, fund_class: 'fixed' },
]

describe('знак операции относительно фонда', () => {
  it('на «Поступлениях» приход — плюс, возврат клиенту — минус', () => {
    expect(signedAmount({ kind: 'in', amount: 100 }, 'income')).toBe(100)
    expect(signedAmount({ kind: 'out', amount: 100 }, 'income')).toBe(-100)
  })
  it('на расходном фонде расход — плюс, приход (кредит, сторно, возврат поставщика) — минус', () => {
    expect(signedAmount({ kind: 'out', amount: '250.5' }, 'fixed')).toBe(250.5)
    expect(signedAmount({ kind: 'in', amount: 250.5 }, 'fund')).toBe(-250.5)
  })
})

describe('ООО, август 2026: возврат 30 902 ₽ от 19.08 уменьшает поступления', () => {
  const entries = [
    { kind: 'in', amount: 703277, fund_id: 18, subfund_id: 94 },
    { kind: 'in', amount: 2019887.2, fund_id: 18, subfund_id: 95 },
    { kind: 'out', amount: 30902, fund_id: 18, subfund_id: 97 },
  ]
  it('поступления 2 692 262,20 ₽, а не 2 754 066,20 ₽, как складывал экран', () => {
    expect(entries.reduce((s, e) => s + e.amount, 0)).toBeCloseTo(2754066.2, 2)
    expect(incomeOf(entries, OOO_FUNDS)).toBeCloseTo(2692262.2, 2)
  })
  it('подфонд «возвраты» показывается минусом, и подфонды сходятся с фондом', () => {
    const { byFund, bySub } = signedSums(entries, OOO_FUNDS)
    expect(bySub.get(97)).toBe(-30902)
    const subs = [...bySub.values()].reduce((s, v) => s + v, 0)
    expect(subs).toBeCloseTo(byFund.get(18)!, 2)
  })
})

describe('ИП, апрель 2026: кредит 3 300 000 ₽ на фонде «Кредиты» — приход, а не расход', () => {
  const entries = [
    { kind: 'in', amount: 4613272, fund_id: 1, subfund_id: 4 },
    { kind: 'in', amount: 965622, fund_id: 1, subfund_id: 1 },
    { kind: 'out', amount: 2500, fund_id: 1, subfund_id: 6 },
    { kind: 'in', amount: 3300000, fund_id: 8, subfund_id: null },
  ]
  it('фонд «Кредиты» уходит в минус на сумму кредита', () => {
    expect(signedSums(entries, IP_FUNDS).byFund.get(8)).toBe(-3300000)
  })
  it('в поступления кредит не попадает: 5 576 394 ₽', () => {
    expect(incomeOf(entries, IP_FUNDS)).toBe(5576394)
  })
})

describe('доли на экране ОДДС', () => {
  // ИП, февраль 2026: поступления 3 890 507,50, переменные 1 651 251,65, маржа 2 239 255,85
  it('сдельная 619 901 ₽ — 15,9% поступлений (на экране стоял норматив 15,979%)', () => {
    expect(share(619901, 3890507.5)).toBeCloseTo(15.93, 2)
  })
  it('оклады 605 000 ₽ — 15,6% поступлений и 27,0% маржи после переменных', () => {
    expect(share(605000, 3890507.5)).toBeCloseTo(15.55, 2)
    expect(share(605000, 2239255.85)).toBeCloseTo(27.02, 2)
  })
  it('от нуля и от убытка доли нет', () => {
    expect(share(100, 0)).toBeNull()
    expect(share(100, -5000)).toBeNull()
  })
})

describe('Финнеделя и остатки фондов в комитете', () => {
  const weeks = finWeeksOfMonth('2026-04')
  const FUNDS: FundLike[] = [
    { id: 1, name: 'Поступления', fund_class: 'income', percent: null, sort: 0 },
    { id: 2, name: 'Сдельная зарплата', fund_class: 'variable', percent: 20, sort: 1 },
    { id: 8, name: 'Кредиты', fund_class: 'fund', percent: 10, sort: 2 },
  ]
  const entries = [
    { entry_date: '2026-04-09', kind: 'in', fund_id: 1, amount: 1_000_000 },
    { entry_date: '2026-04-10', kind: 'in', fund_id: 8, amount: 3_300_000 },  // кредит
    { entry_date: '2026-04-11', kind: 'out', fund_id: 1, amount: 50_000 },    // возврат клиенту
    { entry_date: '2026-04-11', kind: 'out', fund_id: 2, amount: 120_000 },
    { entry_date: '2026-04-13', kind: 'in', fund_id: 2, amount: 20_000 },     // сторно
  ]
  it('«поступило за неделю» — без кредита и за вычетом возврата', () => {
    expect(weeks[1]).toEqual({ start: '2026-04-09', end: '2026-04-15' })
    expect(weekIncome(entries, FUNDS, weeks[1])).toBe(950_000)
  })
  it('кредит не разливается по фондам, сторно уменьшает «потрачено»', () => {
    const avail = fundAvailability(weeks, entries, FUNDS)
    expect(avail.get(2)!.allocated).toBe(190_000)   // 20% от 950 000
    expect(avail.get(2)!.spent).toBe(100_000)       // 120 000 − 20 000
    expect(avail.get(8)!.spent).toBe(-3_300_000)    // кредит лежит в своём фонде
  })
})
