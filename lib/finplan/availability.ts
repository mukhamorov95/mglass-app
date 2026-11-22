// ФП Ф4а: свободно к одобрению по фондам юнита — сервер и экран считают одинаково.
// Остаток фонда = заливка денег клиентов за периоды текущего месяца − расходы фонда
// (lib/finweek fundAvailability); минус резервы окончательно утверждённых недель.
import type { SupabaseClient } from '@supabase/supabase-js'
import { monthPeriods, fundAvailability, type CashEntryLike, type FundLike } from '@/lib/finweek'
import { reservesByFund, type ReqLike, type PayLike } from '@/lib/finplan/requests'

export type FundFree = { fund_id: number; available: number; reserved: number; free: number }

export function freeByFund(funds: FundLike[], entries: CashEntryLike[], nonIncome: ReadonlySet<number>, ym: string,
  reqs: ReqLike[], pays: PayLike[], finalWeeks: ReadonlySet<string>, exceptWeek?: string): Map<number, FundFree> {
  const weeks = monthPeriods(ym).map(p => ({ start: p.start, end: p.end }))
  const avail = fundAvailability(weeks, entries, funds, nonIncome)
  const res = reservesByFund(reqs, pays, finalWeeks, exceptWeek)
  const out = new Map<number, FundFree>()
  for (const f of funds) {
    if (f.percent == null) continue
    const available = Math.round((avail.get(f.id)?.available ?? 0) * 100) / 100
    const reserved = res.get(f.id) ?? 0
    out.set(f.id, { fund_id: f.id, available, reserved, free: Math.round((available - reserved) * 100) / 100 })
  }
  return out
}

export async function loadFundFree(svc: SupabaseClient, unit: 'ip' | 'ooo', today: string, exceptWeek?: string) {
  const ym = today.slice(0, 7)
  const periods = monthPeriods(ym)
  const [f, e, s, q, d] = await Promise.all([
    svc.from('cashflow_funds').select('id,name,fund_class,percent,sort').eq('unit', unit).eq('active', true),
    svc.from('cashflow_entries').select('entry_date,kind,fund_id,subfund_id,amount').eq('unit', unit)
      .gte('entry_date', periods[0].start).lte('entry_date', periods[periods.length - 1].end).range(0, 19999),
    svc.from('cashflow_subfunds').select('id').eq('non_income', true),
    svc.from('payment_requests').select('id,fund_id,amount,approved_amount,status,week_end,closed_at,decision').eq('unit', unit).neq('status', 'cancelled').range(0, 9999),
    svc.from('fp_directives').select('week_end').eq('unit', unit).eq('status', 'final'),
  ])
  for (const x of [f, e, s, q, d]) if (x.error) throw new Error(x.error.message)
  const reqs = (q.data ?? []) as ReqLike[]
  const ids = reqs.map(x => x.id)
  const p = ids.length ? await svc.from('payment_request_payments').select('request_id,amount').in('request_id', ids) : { data: [], error: null }
  if (p.error) throw new Error(p.error.message)
  const finalWeeks = new Set(((d.data ?? []) as { week_end: string }[]).map(x => x.week_end))
  return {
    reqs, pays: (p.data ?? []) as PayLike[], finalWeeks,
    free: freeByFund((f.data ?? []) as FundLike[], (e.data ?? []) as CashEntryLike[],
      new Set(((s.data ?? []) as { id: number }[]).map(x => x.id)), ym, reqs, (p.data ?? []) as PayLike[], finalWeeks, exceptWeek),
  }
}
