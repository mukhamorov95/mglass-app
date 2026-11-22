// ФП Ф3: сверка остатка счёта. Остаток на конец дня = опорный остаток +
// поступления − выплаты ± переводы между своими после опорной даты. Каждый
// остаток банка после опорного — контрольная точка: расхождение, из него не
// проведённые строки выписки, остаток — необъяснённое. Деньги — в копейках.

export type BalanceRow = { account: string; as_of: string; balance: number; source: 'bank' | 'manual' }
export type FlowRow = { account: string; date: string; delta: number } // + приход, − расход
export type UnpostedRow = { account: string; date: string; delta: number }

export type Check = { as_of: string; source: 'bank' | 'manual'; actual: number; computed: number; diff: number; unposted: number; unexplained: number }
export type AccountRecon = { account: string; anchor: BalanceRow | null; current: number | null; asOf: string; checks: Check[]; flowsWithoutAnchor: number }

const k = (v: number) => Math.round(Number(v) * 100)
const r = (v: number) => v / 100

export function reconcileAccount(account: string, balances: BalanceRow[], flows: FlowRow[], unposted: UnpostedRow[], today: string): AccountRecon {
  const own = balances.filter(b => b.account === account)
    .sort((a, b) => a.as_of.localeCompare(b.as_of) || (a.source === 'bank' ? -1 : 1))
  const fl = flows.filter(f => f.account === account)
  const anchor = own[0] ?? null
  if (!anchor) {
    return { account, anchor: null, current: null, asOf: today, checks: [], flowsWithoutAnchor: fl.length }
  }
  const at = (d: string) => k(anchor.balance) + fl.reduce((s, f) => s + (f.date > anchor.as_of && f.date <= d ? k(f.delta) : 0), 0)
  const un = (d: string) => unposted.reduce((s, u) => s + (u.account === account && u.date > anchor.as_of && u.date <= d ? k(u.delta) : 0), 0)
  const checks = own.slice(1).map(b => {
    const computed = at(b.as_of)
    const diff = k(b.balance) - computed
    const unp = b.source === 'bank' ? un(b.as_of) : 0
    return { as_of: b.as_of, source: b.source, actual: r(k(b.balance)), computed: r(computed), diff: r(diff), unposted: r(unp), unexplained: r(diff - unp) }
  })
  return { account, anchor, current: r(at(today)), asOf: today, checks, flowsWithoutAnchor: fl.filter(f => f.date <= anchor.as_of).length }
}

// Строки ДДС и переводы → движения по счетам.
export function flowsFrom(
  entries: { account: string | null; entry_date: string; kind: string; amount: number }[],
  transfers: { op_date: string; from_account: string; to_account: string; amount: number }[],
): FlowRow[] {
  const out: FlowRow[] = []
  for (const e of entries) {
    if (!e.account) continue
    out.push({ account: e.account, date: e.entry_date, delta: e.kind === 'in' ? Number(e.amount) : -Number(e.amount) })
  }
  for (const t of transfers) {
    out.push({ account: t.from_account, date: t.op_date, delta: -Number(t.amount) })
    out.push({ account: t.to_account, date: t.op_date, delta: Number(t.amount) })
  }
  return out
}

// Остатки из выписки: начальный — на день раньше периода, конечный — на последний.
export function balancesFromStatement(b: { account: string; opening: number | null; closing: number | null; dateStart: string | null; dateEnd: string | null }): { account: string; as_of: string; balance: number }[] {
  const out: { account: string; as_of: string; balance: number }[] = []
  if (b.opening != null && b.dateStart) {
    const prev = new Date(Date.parse(b.dateStart + 'T00:00:00Z') - 86_400_000).toISOString().slice(0, 10)
    out.push({ account: b.account, as_of: prev, balance: b.opening })
  }
  if (b.closing != null && b.dateEnd) out.push({ account: b.account, as_of: b.dateEnd, balance: b.closing })
  return out
}

export const accountLabel = (a: string) => /^\d{20}$/.test(a) ? `р/с …${a.slice(-4)}` : a
