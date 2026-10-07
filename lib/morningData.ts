import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { bookNames } from '@/lib/sales/bookNames'
import { pageAllOrError as all } from '@/lib/supabase/pageAll'
import { addBookFacts, emptyMonth, isWorkday, nextMonth as addMonth, pickDay, prevMonth, type DayRow, type MonthMoney, type Schedule } from '@/lib/morning'
import { DEFAULT_MANAGER_COMMISSION_TIERS, DEFAULT_MANAGER_SALARY_RUB, type CommissionTier } from '@/lib/earnings/calculateProgressiveCommission'

// Данные «Утра». Читает service-ключом: кто что видит, решает страница до вызова —
// менеджеру передаётся только его amo-id.

export type MorningPerson = {
  amoUserId: number
  name: string
  schedule?: Schedule
  row?: DayRow
  month: MonthMoney
  prev: MonthMoney
  firstHalf: number          // поступления 1–15 текущего месяца — выплата 27-го
  prevFirstHalf: number      // то же за прошлый месяц — добор 15-го считается от него
  plan: number | null        // план месяца в поступлениях (manager_month_plans)
  nextPlan: number | null    // план следующего месяца — для редактора владельца
}

export type Morning = {
  today: string
  day: string | null
  updatedAt: string | null   // когда снят день (сегодняшний — по кнопке)
  month: string
  prev: string
  bookLastDay: string | null
  people: MorningPerson[]
  pay: { tiers: CommissionTier[]; salary: number }
  errors: string[]
}

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const BOOK_METRICS = ['prepay', 'remainder', 'payments', 'talks', 'measure_assigned', 'measure_done']

// day — день выбран руками (владелец на «Утре» менеджера); иначе последний рабочий.
export async function loadMorning(sb: SupabaseClient, opts: { today: string; only?: number; day?: string }): Promise<Morning> {
  const { today } = opts
  const month = today.slice(0, 7)
  const prev = prevMonth(month)
  const errors: string[] = []
  const note = (what: string, e: { message: string } | null) => { if (e) errors.push(`${what}: ${e.message}`) }

  const [sch, users, snap, plans, settings] = await Promise.all([
    sb.from('manager_schedules').select('amo_user_id, name, work_from, work_to, work_days, starts_on, is_seller'),
    sb.from('users').select('name, amo_user_id').not('amo_user_id', 'is', null),
    // Один день — по строке на сотрудника amo, 200 с запасом; две недели читаем целиком.
    opts.day
      ? sb.from('manager_day_stats').select('*').eq('day', opts.day).limit(200)
      : all<DayRow>((a, b) => sb.from('manager_day_stats').select('*').gte('day', addDays(today, -14)).lt('day', today)
        .order('day').order('amo_user_id').range(a, b)),
    sb.from('manager_month_plans').select('month, amo_user_id, plan_money').in('month', [month, addMonth(month)]),
    sb.from('earnings_settings').select('base_salary_rub, commission_tiers').eq('scope', 'b2c_manager').maybeSingle(),
  ])
  note('график', sch.error); note('сотрудники', users.error); note('снимок дня', snap.error)
  note('планы', plans.error); note('правила мотивации', settings.error)
  const pay = {
    tiers: Array.isArray(settings.data?.commission_tiers) ? (settings.data.commission_tiers as CommissionTier[]) : DEFAULT_MANAGER_COMMISSION_TIERS,
    salary: Number(settings.data?.base_salary_rub ?? DEFAULT_MANAGER_SALARY_RUB),
  }
  const planOf = (m: string, id: number) => {
    const p = (plans.data ?? []).find(x => x.month === m && Number(x.amo_user_id) === id)
    return p?.plan_money != null ? Number(p.plan_money) : null
  }

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
  const day = opts.day ?? pickDay([...byDay].map(([d, actions]) => ({ day: d, actions })), today, workday)
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
      month: emptyMonth(), prev: emptyMonth(), firstHalf: 0, prevFirstHalf: 0,
      plan: planOf(month, id), nextPlan: planOf(addMonth(month), id),
    }
  })
  const byId = new Map(people.map(p => [p.amoUserId, p]))
  const names = [...owner.keys()]
  const updatedAt = rows.filter(r => r.day === day).map(r => r.updated_at ?? '').sort().at(-1) || null
  if (!names.length) return { today, day, updatedAt, month, prev, bookLastDay: null, people, pay, errors }

  const [sales, daily, monthly, last] = await Promise.all([
    // Деньги двух месяцев — страницами: .limit(5000) потолок PostgREST в 1000 не поднимал.
    all<{ manager: string; amount: number; sale_date: string }>((a, b) => sb.from('crm_sales').select('manager, amount, sale_date')
      .gte('sale_date', `${prev}-01`).lt('sale_date', `${addMonth(month)}-01`)
      .eq('voided', false).neq('department', 'b2b').in('manager', names).order('id').range(a, b)),
    all<{ stat_date: string; manager: string; metric: string; value: number }>((a, b) => sb.from('manager_stats_daily')
      .select('stat_date, manager, metric, value')
      .gte('stat_date', `${prev}-01`).lt('stat_date', `${addMonth(month)}-01`)
      .in('manager', names).in('metric', BOOK_METRICS).order('stat_date').order('manager').order('metric').range(a, b)),
    // Прошлый месяц — итогом месяца из книги, как на «Показателях менеджеров». Один месяц —
    // по строке на метрику человека (07.10 — 37 строк на месяц всего), 1000 хватает.
    sb.from('manager_stats_monthly').select('manager, metric, value')
      .eq('month', prev).in('manager', names).in('metric', BOOK_METRICS).limit(1000),
    sb.from('manager_stats_daily').select('stat_date').neq('value', 0)
      .order('stat_date', { ascending: false }).limit(1).maybeSingle(),
  ])
  note('продажи', sales.error); note('книга по дням', daily.error); note('книга по месяцам', monthly.error)

  for (const s of sales.data) {
    const p = byId.get(owner.get(s.manager) ?? -1)
    if (!p) continue
    const m = s.sale_date.startsWith(month) ? p.month : p.prev
    m.salesCount++
    m.salesSum += Number(s.amount) || 0
  }
  for (const f of daily.data) {
    const p = byId.get(owner.get(f.manager) ?? -1)
    if (!p) continue
    const cur = f.stat_date.startsWith(month)
    // Прошлый месяц целиком берётся итогом книги ниже; по дням нужна только его первая половина.
    if (cur) addBookFacts(p.month, [f])
    if ((f.metric === 'prepay' || f.metric === 'remainder') && Number(f.stat_date.slice(8, 10)) <= 15) {
      if (cur) p.firstHalf += Number(f.value) || 0
      else p.prevFirstHalf += Number(f.value) || 0
    }
  }
  for (const f of (monthly.data ?? []) as { manager: string; metric: string; value: number }[]) {
    const p = byId.get(owner.get(f.manager) ?? -1)
    if (p) addBookFacts(p.prev, [f])
  }

  return { today, day, updatedAt, month, prev, bookLastDay: (last.data?.stat_date as string | undefined) ?? null, people, pay, errors }
}
