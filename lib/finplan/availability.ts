// ФП Ф4а/Ф5: свободно к одобрению по фондам юнита — сервер и экраны считают одинаково.
// Остаток фонда = распределено по методике за завершённые финнедели месяца
// (lib/finplan/distribute) − расходы фонда по датам месяца; свободно = остаток −
// резервы окончательно утверждённых недель.
import type { SupabaseClient } from '@supabase/supabase-js'
import { monthPeriods, isClientIncome, type IncomeEntry } from '@/lib/finweek'
import { distributeMonth, allocatedByFund, type DistFund, type DistWeek } from '@/lib/finplan/distribute'
import { reservesByFund, type ReqLike, type PayLike } from '@/lib/finplan/requests'

export type FundRow = { id: number; name: string; fund_class: string; percent: number | null; sort: number }
export type FundFree = { fund_id: number; available: number; reserved: number; free: number }
export type NeedSource = 'subfund_plans' | 'month_plan' | 'week_income'
type Entry = IncomeEntry & { fund_id: number }

// Месячная потребность постоянного фонда: план подфондов (ОДДС) → % от плана
// месяца → null (тогда % от денег недели).
export function distFunds(funds: FundRow[], subPlanByFund: ReadonlyMap<number, number>, monthPlan: number | null): (DistFund & { source: NeedSource | null })[] {
  return funds.filter(f => ['variable', 'fund', 'fixed'].includes(f.fund_class)).map(f => {
    const sub = subPlanByFund.get(f.id) ?? 0
    let monthlyNeed: number | null = null
    let source: NeedSource | null = null
    if (f.fund_class === 'fixed') {
      if (sub > 0) { monthlyNeed = sub; source = 'subfund_plans' }
      else if (monthPlan != null && f.percent != null) { monthlyNeed = Math.round(monthPlan * Math.max(0, Number(f.percent))) / 100; source = 'month_plan' }
      else source = 'week_income'
    }
    return { id: f.id, name: f.name, fund_class: f.fund_class as DistFund['fund_class'], percent: f.percent == null ? null : Number(f.percent), sort: f.sort, monthlyNeed, source }
  })
}

// Финнедели месяца (по средам) и деньги клиентов каждой целиком; done — завершены к today.
export function monthWeeks(ym: string, entries: IncomeEntry[], nonIncome: ReadonlySet<number>, today: string) {
  return monthPeriods(ym).filter(p => !p.tail).map(p => ({
    week_end: p.week.end, start: p.week.start, done: today > p.week.end,
    income: entries.reduce((s, e) => s + (isClientIncome(e, nonIncome) && e.entry_date >= p.week.start && e.entry_date <= p.week.end ? Number(e.amount) : 0), 0),
  }))
}

export function computeDistribution(ym: string, funds: FundRow[], entries: IncomeEntry[], nonIncome: ReadonlySet<number>, today: string,
  subPlanByFund: ReadonlyMap<number, number>, monthPlan: number | null): DistWeek[] {
  // Незавершённая неделя ещё не распределяется — её деньги считаются нулём.
  const weeks = monthWeeks(ym, entries, nonIncome, today).map(w => ({ week_end: w.week_end, income: w.done ? w.income : 0 }))
  return distributeMonth(weeks, distFunds(funds, subPlanByFund, monthPlan))
}

export function freeByFund(funds: FundRow[], entries: Entry[], nonIncome: ReadonlySet<number>, ym: string, today: string,
  subPlanByFund: ReadonlyMap<number, number>, monthPlan: number | null,
  reqs: ReqLike[], pays: PayLike[], finalWeeks: ReadonlySet<string>, exceptWeek?: string): Map<number, FundFree> {
  const alloc = allocatedByFund(computeDistribution(ym, funds, entries, nonIncome, today, subPlanByFund, monthPlan))
  const spent = new Map<number, number>()
  for (const e of entries) if (e.kind === 'out' && e.entry_date.startsWith(ym)) spent.set(e.fund_id, (spent.get(e.fund_id) ?? 0) + Math.round(Number(e.amount) * 100))
  const res = reservesByFund(reqs, pays, finalWeeks, exceptWeek)
  const out = new Map<number, FundFree>()
  for (const f of funds) {
    if (!['variable', 'fund', 'fixed'].includes(f.fund_class)) continue
    const available = (Math.round((alloc.get(f.id) ?? 0) * 100) - (spent.get(f.id) ?? 0)) / 100
    const reserved = res.get(f.id) ?? 0
    out.set(f.id, { fund_id: f.id, available, reserved, free: Math.round((available - reserved) * 100) / 100 })
  }
  return out
}

export async function loadFundFree(svc: SupabaseClient, unit: 'ip' | 'ooo', today: string, exceptWeek?: string) {
  const ym = today.slice(0, 7)
  const periods = monthPeriods(ym)
  const from = periods[0].week.start < periods[0].start ? periods[0].week.start : periods[0].start
  const [f, e, s, q, d, mp] = await Promise.all([
    svc.from('cashflow_funds').select('id,name,fund_class,percent,sort').eq('unit', unit).eq('active', true),
    svc.from('cashflow_entries').select('entry_date,kind,fund_id,subfund_id,amount').eq('unit', unit)
      .gte('entry_date', from).lte('entry_date', periods[periods.length - 1].end).range(0, 19999),
    svc.from('cashflow_subfunds').select('id,fund_id,non_income'),
    svc.from('payment_requests').select('id,fund_id,amount,approved_amount,status,week_end,closed_at,decision').eq('unit', unit).neq('status', 'cancelled').range(0, 9999),
    svc.from('fp_directives').select('week_end').eq('unit', unit).eq('status', 'final'),
    svc.from('cashflow_month_plans').select('plan_amount').eq('unit', unit).eq('month', ym).maybeSingle(),
  ])
  for (const x of [f, e, s, q, d, mp]) if (x.error) throw new Error(x.error.message)
  const subs = (s.data ?? []) as { id: number; fund_id: number; non_income: boolean }[]
  const sp = await svc.from('cashflow_subfund_plans').select('subfund_id,plan_monthly')
  if (sp.error) throw new Error(sp.error.message)
  const fundOfSub = new Map(subs.map(x => [x.id, x.fund_id]))
  const subPlanByFund = new Map<number, number>()
  for (const p of (sp.data ?? []) as { subfund_id: number; plan_monthly: number }[]) {
    const fid = fundOfSub.get(p.subfund_id)
    if (fid != null) subPlanByFund.set(fid, (subPlanByFund.get(fid) ?? 0) + Number(p.plan_monthly))
  }
  const reqs = (q.data ?? []) as ReqLike[]
  const ids = reqs.map(x => x.id)
  const p = ids.length ? await svc.from('payment_request_payments').select('request_id,amount').in('request_id', ids) : { data: [], error: null }
  if (p.error) throw new Error(p.error.message)
  const finalWeeks = new Set(((d.data ?? []) as { week_end: string }[]).map(x => x.week_end))
  const monthPlan = mp.data ? Number((mp.data as { plan_amount: number }).plan_amount) : null
  const nonIncome = new Set(subs.filter(x => x.non_income).map(x => x.id))
  const funds = (f.data ?? []) as FundRow[]
  return {
    reqs, pays: (p.data ?? []) as PayLike[], finalWeeks,
    free: freeByFund(funds, (e.data ?? []) as Entry[], nonIncome, ym, today, subPlanByFund, monthPlan, reqs, (p.data ?? []) as PayLike[], finalWeeks, exceptWeek),
  }
}
