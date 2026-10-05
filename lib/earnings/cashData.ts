import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { bookNames } from '@/lib/sales/bookNames'
import { nextMonth as addMonth, prevMonth } from '@/lib/morning'
import { cashOf, type CashDay, type CashMonth } from '@/lib/earnings/cash'

// Поступления менеджера из «Аналитики дохода» для «Моих заработков» (М5). Закрытые
// месяцы — итогом месяца книги (manager_stats_monthly), текущий и прошлый — ещё и по
// дням (manager_stats_daily): по дням делятся выплаты 27-го и 15-го. Читает
// service-ключом: кого показывать, решает API до вызова.

export type CashData = {
  amoUserId: number
  name: string
  today: string
  month: string
  prev: string
  months: CashMonth[]        // от свежего к старому, текущий — первым
  days: CashDay[]            // текущий месяц
  prevDays: CashDay[]        // прошлый месяц — для выплаты 15-го
  plan: number | null
  workDays: number[]
  bookLastDay: string | null
  errors: string[]
}

const METRICS = ['prepay', 'remainder', 'payments']

export async function loadCash(sb: SupabaseClient, opts: { today: string; amoUserId: number }): Promise<CashData> {
  const { today, amoUserId } = opts
  const month = today.slice(0, 7)
  const prev = prevMonth(month)
  const errors: string[] = []
  const note = (what: string, e: { message: string } | null) => { if (e) errors.push(`${what}: ${e.message}`) }

  const [sch, usr, plan, last] = await Promise.all([
    sb.from('manager_schedules').select('name, work_days').eq('amo_user_id', amoUserId).maybeSingle(),
    sb.from('users').select('name').eq('amo_user_id', amoUserId).limit(1).maybeSingle(),
    sb.from('manager_month_plans').select('plan_money').eq('month', month).eq('amo_user_id', amoUserId).maybeSingle(),
    sb.from('manager_stats_daily').select('stat_date').neq('value', 0)
      .order('stat_date', { ascending: false }).limit(1).maybeSingle(),
  ])
  note('график', sch.error); note('сотрудник', usr.error); note('план', plan.error)

  const name = (sch.data?.name as string | undefined) ?? (usr.data?.name as string | undefined) ?? `amo #${amoUserId}`
  const names = [...new Set([...bookNames(name), ...bookNames((usr.data?.name as string | undefined) ?? '')])].filter(Boolean)
  const workDays = Array.isArray(sch.data?.work_days) && sch.data.work_days.length ? (sch.data.work_days as number[]) : [1, 2, 3, 4, 5]

  const [monthly, daily] = await Promise.all([
    sb.from('manager_stats_monthly').select('month, metric, value')
      .lt('month', month).in('manager', names).in('metric', METRICS).limit(5000),
    sb.from('manager_stats_daily').select('stat_date, metric, value')
      .gte('stat_date', `${prev}-01`).lt('stat_date', `${addMonth(month)}-01`)
      .in('manager', names).in('metric', METRICS).limit(5000),
  ])
  note('книга по месяцам', monthly.error); note('книга по дням', daily.error)

  const byMonth = new Map<string, CashMonth>()
  const monthOf = (k: string) => byMonth.get(k) ?? byMonth.set(k, { month: k, prepay: 0, remainder: 0, payments: 0 }).get(k)!
  for (const f of (monthly.data ?? []) as { month: string; metric: string; value: number }[]) add(monthOf(f.month), f)

  const byDay = new Map<string, CashDay>()
  const cur = monthOf(month)
  for (const f of (daily.data ?? []) as { stat_date: string; metric: string; value: number }[]) {
    if (f.stat_date.startsWith(month)) add(cur, f)
    if (f.metric === 'payments') continue
    const d = byDay.get(f.stat_date) ?? byDay.set(f.stat_date, { date: f.stat_date, prepay: 0, remainder: 0 }).get(f.stat_date)!
    d[f.metric as 'prepay' | 'remainder'] += Number(f.value) || 0
  }
  const days = [...byDay.values()].filter(d => cashOf(d) !== 0).sort((a, b) => a.date.localeCompare(b.date))

  return {
    amoUserId, name, today, month, prev,
    months: [...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month)),
    days: days.filter(d => d.date.startsWith(month)),
    prevDays: days.filter(d => d.date.startsWith(prev)),
    plan: plan.data?.plan_money != null ? Number(plan.data.plan_money) : null,
    workDays,
    bookLastDay: (last.data?.stat_date as string | undefined) ?? null,
    errors,
  }
}

function add(m: CashMonth, f: { metric: string; value: number }) {
  const k = f.metric as 'prepay' | 'remainder' | 'payments'
  if (k in m) m[k] += Number(f.value) || 0
}
