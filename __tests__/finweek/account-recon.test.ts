import { describe, it, expect } from 'vitest'
import { reconcileAccount, flowsFrom, balancesFromStatement, accountLabel } from '@/lib/accountRecon'

const A = '40702810701300039842'
const CASH = 'Наличные касса'

describe('сверка счёта: нач. остаток + приход − расход ± переводы = кон. остаток', () => {
  const entries = [
    { account: A, entry_date: '2026-11-02', kind: 'in', amount: 500_000 },
    { account: A, entry_date: '2026-11-03', kind: 'out', amount: 120_000.5 },
    { account: A, entry_date: '2026-10-31', kind: 'in', amount: 999 }, // до опорной даты — не считается
  ]
  const transfers = [{ op_date: '2026-11-04', from_account: A, to_account: CASH, amount: 30_000 }]
  const flows = flowsFrom(entries, transfers)
  const balances = [
    { account: A, as_of: '2026-11-01', balance: 10_000, source: 'bank' as const },
    { account: A, as_of: '2026-11-05', balance: 359_999.5, source: 'bank' as const },
  ]

  it('сходится до копейки — расхождение 0', () => {
    const r = reconcileAccount(A, balances, flows, [], '2026-11-05')
    expect(r.checks).toEqual([{ as_of: '2026-11-05', source: 'bank', actual: 359_999.5, computed: 359_999.5, diff: 0, unposted: 0, unexplained: 0 }])
    expect(r.current).toBe(359_999.5)
    expect(r.flowsWithoutAnchor).toBe(1)
  })

  it('расхождение объясняется непроведёнными строками выписки', () => {
    const bank = [...balances.slice(0, 1), { account: A, as_of: '2026-11-05', balance: 409_999.5, source: 'bank' as const }]
    const r = reconcileAccount(A, bank, flows, [{ account: A, date: '2026-11-05', delta: 50_000 }], '2026-11-05')
    expect(r.checks[0]).toMatchObject({ diff: 50_000, unposted: 50_000, unexplained: 0 })
  })

  it('перевод между своими: один счёт −, другой +, общий остаток не меняется', () => {
    const cash = reconcileAccount(CASH, [{ account: CASH, as_of: '2026-11-01', balance: 0, source: 'manual' }], flows, [], '2026-11-05')
    const bank = reconcileAccount(A, balances, flows, [], '2026-11-05')
    expect(cash.current).toBe(30_000)
    const withoutTransfer = reconcileAccount(A, balances, flowsFrom(entries, []), [], '2026-11-05').current!
    expect(bank.current! + cash.current!).toBe(withoutTransfer)
  })

  it('без опорного остатка сверки нет, но видно, сколько движений ждут', () => {
    const r = reconcileAccount(CASH, [], flows, [], '2026-11-05')
    expect(r).toMatchObject({ anchor: null, current: null, flowsWithoutAnchor: 1 })
  })
})

describe('остатки из выписки 1С', () => {
  it('начальный — на день раньше периода, конечный — последний день', () => {
    expect(balancesFromStatement({ account: A, opening: 100, closing: 250, dateStart: '2026-11-01', dateEnd: '2026-11-21' })).toEqual([
      { account: A, as_of: '2026-10-31', balance: 100 },
      { account: A, as_of: '2026-11-21', balance: 250 },
    ])
  })
  it('подпись р/с по последним цифрам', () => {
    expect(accountLabel(A)).toBe('р/с …9842')
    expect(accountLabel(CASH)).toBe(CASH)
  })
})
