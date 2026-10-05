import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { bookNames } from '@/lib/sales/bookNames'
import { addBookFacts, emptyMonth, isWorkday, pickDay, prevMonth, type DayRow, type MonthMoney, type Schedule } from '@/lib/morning'

// Данные «Утра». Читает service-ключом: кто что видит, решает страница до вызова —
// менеджеру передаётся только его amo-id.

export type MorningPerson = {
  amoUserId: number
  name: string
  schedule?: Schedule
  row?: DayRow
  month: MonthMoney
  prev: MonthMoney
}

export type Morning = {
  today: string
  day: string | null
  month: string
  prev: string
  bookLastDay: string | null
  people: MorningPerson[]
  errors: string[]
}

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const BOOK_METRICS = ['prepay', 'remainder', 'payments', 'talks', 'measure_assigned', 'measure_done']

export async function loadMorning(sb: SupabaseClient, opts: { today: string; only?: number }): Promise<Morning> {
  const { today } = opts
  const month = today.slice(0, 7)
  const prev = prevMonth(month)
  const errors: string[] = []
  const note = (what: string, e: { message: string } | null) => { if (e) errors.push(`${what}: ${e.message}`) }

  const [sch, users, snap] = await Promise.all([
    sb.from('manager_schedules').select('amo_user_id, name, work_from, work_to, work_days, starts_on, is_seller'),
    sb.from('users').select('name, amo_user_id').not('amo_user_id', 'is', null),
    sb.from('manager_day_stats').select('*').gte('day', addDays(today, -14)).lt('day', today).limit(2000),
  ])
  note('график', sch.error); note('сотрудники', users.error); note('снимок дня', snap.error)

  const schedules = new Map(((sch.data ?? []) as (Schedule & { is_seller: boolean | null })[]).map(s => [Number(s.amo_user_id), s]))
  const rows = (snap.data ?? []) as DayRow[]
  const sellers = [...schedules.values()].filter(s => s.is_seller).map(s => Number(s.amo_user_id))
  const ids = opts.only != null ? [opts.only] : sellers

  // День выбираем по всей команде: если человек не работал, ему честно покажут ноль,
  // а не его последний рабочий день недельной давности.
  const byDay = new Map<string, number>()
  for (const r of rows) if (sellers.includes(Number(r.amo_user_id))) byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.actions)
  const sellerSchedules = sellers.map(id => schedules.get(id))
  const workday = (d: string) => sellerSchedules.some(s => isWorkday(d, s))
  const day = pickDay([...byDay].map(([d, actions]) => ({ day: d, actions })), today, workday)
    ?? pickDay(rows.map(r => ({ day: r.day, actions: r.actions })), today)

  const userName = new Map(((users.data ?? []) as { name: string | null; amo_user_id: number }[]).map(u => [Number(u.amo_user_id), u.name ?? '']))
  const owner = new Map<string, number>()
  const people: MorningPerson[] = ids.map(id => {
    const s = schedules.get(id)
    const name = s?.name ?? userName.get(id) ?? `amo #${id}`
    for (const n of [...bookNames(name), ...bookNames(userName.get(id) ?? '')]) owner.set(n, id)
    return {
      amoUserId: id, name, schedule: s,
      row: rows.find(r => Number(r.amo_user_id) === id && r.day === day),
      month: emptyMonth(), prev: emptyMonth(),
    }
  })
  const byId = new Map(people.map(p => [p.amoUserId, p]))
  const names = [...owner.keys()]
  if (!names.length) return { today, day, month, prev, bookLastDay: null, people, errors }

  const [sales, daily, monthly, last] = await Promise.all([
    sb.from('crm_sales').select('manager, amount, sale_date')
      .gte('sale_date', `${prev}-01`).lt('sale_date', `${addMonth(month)}-01`)
      .eq('voided', false).neq('department', 'b2b').in('manager', names).limit(5000),
    sb.from('manager_stats_daily').select('manager, metric, value')
      .gte('stat_date', `${month}-01`).lt('stat_date', `${addMonth(month)}-01`)
      .in('manager', names).in('metric', BOOK_METRICS).limit(5000),
    // Прошлый месяц — итогом месяца из книги, как на «Показателях менеджеров».
    sb.from('manager_stats_monthly').select('manager, metric, value')
      .eq('month', prev).in('manager', names).in('metric', BOOK_METRICS).limit(5000),
    sb.from('manager_stats_daily').select('stat_date').neq('value', 0)
      .order('stat_date', { ascending: false }).limit(1).maybeSingle(),
  ])
  note('продажи', sales.error); note('книга по дням', daily.error); note('книга по месяцам', monthly.error)

  for (const s of (sales.data ?? []) as { manager: string; amount: number; sale_date: string }[]) {
    const p = byId.get(owner.get(s.manager) ?? -1)
    if (!p) continue
    const m = s.sale_date.startsWith(month) ? p.month : p.prev
    m.salesCount++
    m.salesSum += Number(s.amount) || 0
  }
  for (const f of (daily.data ?? []) as { manager: string; metric: string; value: number }[]) {
    const p = byId.get(owner.get(f.manager) ?? -1)
    if (p) addBookFacts(p.month, [f])
  }
  for (const f of (monthly.data ?? []) as { manager: string; metric: string; value: number }[]) {
    const p = byId.get(owner.get(f.manager) ?? -1)
    if (p) addBookFacts(p.prev, [f])
  }

  return { today, day, month, prev, bookLastDay: (last.data?.stat_date as string | undefined) ?? null, people, errors }
}

function addMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7)
}
