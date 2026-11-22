// ФП Ф2: снимок закрывшегося периода (среда или конец месяца) — что было
// известно в момент закрытия. Чистая функция: данные приходят параметрами.
import { monthPeriods, buildPeriodPlans, monthStatus, incomeSplit, type IncomeEntry, type StoredPeriod } from '@/lib/finweek'

export type PlanRow = { unit: 'ip' | 'ooo'; month: string; plan_amount: number; periods: StoredPeriod[] | null; approved_at: string | null }

export type SnapshotRow = {
  unit: 'ip' | 'ooo'; month: string; period_start: string; period_end: string; tail: boolean
  month_plan: number; approved: boolean; base_period: number; plan_period: number; fact_period: number
  non_income_period: number; cum_base: number; cum_fact: number; lag: number; remaining: number; next_targets: number[]
}

// day — закрывшийся день (МСК). Снимок есть, только если day — конец периода.
export function snapshotFor(plan: PlanRow, day: string, entries: IncomeEntry[], nonIncome: ReadonlySet<number>): SnapshotRow | null {
  const periods = monthPeriods(plan.month)
  const idx = periods.findIndex(p => p.end === day)
  if (idx < 0) return null
  const split = periods.map(p => incomeSplit(entries, p.start, p.end, nonIncome))
  const nextDay = new Date(Date.parse(day + 'T00:00:00Z') + 86_400_000).toISOString().slice(0, 10)
  const rows = buildPeriodPlans(Number(plan.plan_amount), periods, split.map((s, i) => (i <= idx ? s.client : 0)), nextDay, plan.periods)
  const st = monthStatus(rows, Number(plan.plan_amount))
  const r = rows[idx]
  return {
    unit: plan.unit, month: plan.month, period_start: r.period.start, period_end: r.period.end, tail: r.period.tail,
    month_plan: Number(plan.plan_amount), approved: !!plan.approved_at,
    base_period: r.base, plan_period: r.plan, fact_period: r.fact, non_income_period: split[idx].nonIncome,
    cum_base: st.cumBase, cum_fact: st.cumFact, lag: st.lag, remaining: st.remaining, next_targets: st.nextTargets,
  }
}
