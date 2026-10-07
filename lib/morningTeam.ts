import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { bookNames } from '@/lib/sales/bookNames'
import { pageAllOrError as all } from '@/lib/supabase/pageAll'
import {
  addBookFacts, addDays, bookSplit, emptyMonth, isWorkday, monthEnd, nextMonth, pickDay, prevMonth, sumActivity,
  type Activity, type DayRow, type MonthMoney, type Schedule, type View,
} from '@/lib/morning'

// «Команда» владельца за выбранный день или период. Активность — снимки дня
// (manager_day_stats), деньги — «Продажи M-Glass» и «Аналитика дохода». Читает
// service-ключом: страница пускает сюда только владельца.

export type TeamPerson = {
  amoUserId: number
  name: string
  schedule?: Schedule
  row?: DayRow               // день — строка снимка
  act: Activity              // период — сумма снимков
  money: MonthMoney
  plan: number | null        // план месяца денег (если период — месяц)
  planNow: number | null     // планы для редактора: текущий и следующий месяц
  planNext: number | null
}

export type Team = {
  today: string
  view: View
  act: {
    from: string
    to: string
    day: string | null       // один день — какой
    days: string[]           // дни со снимком в периоде
    firstSnapshot: string | null
    updatedAt: string | null // когда снят день (для сегодняшнего — «на 14:32»)
  }
  money: { from: string; to: string; month: string | null; prevTotal: number | null }
  bookLastDay: string | null
  people: TeamPerson[]
  others: { names: string[]; money: MonthMoney } | null   // в книге, но не в команде продавцов
  planMonth: string            // месяц, планы которого правит редактор
  errors: string[]
}

const DAY_COLS = '*'
const BOOK_METRICS = ['prepay', 'remainder', 'payments', 'talks', 'measure_assigned', 'measure_done']

export async function loadTeam(sb: SupabaseClient, opts: { today: string; view: View }): Promise<Team> {
  const { today, view } = opts
  const month = today.slice(0, 7)
  const yesterday = addDays(today, -1)
  const errors: string[] = []
  const note = (what: string, e: { message: string } | null) => { if (e) errors.push(`${what}: ${e.message}`) }

  const [sch, users, first] = await Promise.all([
    sb.from('manager_schedules').select('amo_user_id, name, work_from, work_to, work_days, starts_on, is_seller'),
    sb.from('users').select('name, amo_user_id').not('amo_user_id', 'is', null),
    sb.from('manager_day_stats').select('day').order('day', { ascending: true }).limit(1).maybeSingle(),
  ])
  note('график', sch.error); note('сотрудники', users.error)
  const schedules = new Map(((sch.data ?? []) as (Schedule & { is_seller: boolean | null })[]).map(s => [Number(s.amo_user_id), s]))
  const sellers = [...schedules.values()].filter(s => s.is_seller).map(s => Number(s.amo_user_id))
  const firstSnapshot = (first.data?.day as string | undefined) ?? null

  // Какие дни активности: «последний рабочий» выбирается по команде, как на «Утре».
  let actFrom: string, actTo: string, day: string | null = null
  if (view.kind === 'range') {
    actFrom = view.from
    actTo = view.to < today ? view.to : yesterday   // незаконченный сегодняшний день в сумму периода не берём
  } else if (view.kind === 'day') {
    actFrom = actTo = day = view.day
  } else {
    const recent = await all<{ day: string; amo_user_id: number; actions: number }>((a, b) => sb.from('manager_day_stats')
      .select('day, amo_user_id, actions').gte('day', addDays(today, -14)).lt('day', today).order('day').order('amo_user_id').range(a, b))
    note('снимок дня', recent.error)
    const byDay = new Map<string, number>()
    for (const r of recent.data) if (sellers.includes(Number(r.amo_user_id))) byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.actions)
    const workday = (d: string) => sellers.some(id => isWorkday(d, schedules.get(id)))
    day = pickDay([...byDay].map(([d, actions]) => ({ day: d, actions })), today, workday)
      ?? pickDay(recent.data.map(r => ({ day: r.day, actions: r.actions })), today)
    actFrom = actTo = day ?? yesterday
  }

  // Деньги: у выбранного дня — его месяц, у «последнего рабочего» — текущий (как было
  // на «Утре» с первого дня), у периода — сам период.
  const base = (view.kind === 'day' ? view.day : today).slice(0, 7)
  const moneyFrom = view.kind === 'range' ? view.from : `${base}-01`
  const moneyTo = view.kind === 'range' ? view.to : (monthEnd(base) < today ? monthEnd(base) : today)
  const moneyMonth = view.kind === 'range' ? view.month : base
  const planMonth = moneyMonth && moneyMonth >= month ? moneyMonth : month
  const split = bookSplit(moneyFrom, moneyTo, month)

  const [snap, plans, sales, daily, monthly, prevMonthly, last] = await Promise.all([
    actFrom <= actTo
      ? all<DayRow>((a, b) => sb.from('manager_day_stats').select(DAY_COLS).gte('day', actFrom).lte('day', actTo).order('day').order('amo_user_id').range(a, b))
      : Promise.resolve({ data: [] as DayRow[], error: null }),
    sb.from('manager_month_plans').select('month, amo_user_id, plan_money').in('month', [planMonth, nextMonth(planMonth), moneyMonth ?? planMonth]),
    all<{ manager: string; amount: number }>((a, b) => sb.from('crm_sales').select('manager, amount')
      .gte('sale_date', moneyFrom).lte('sale_date', moneyTo).eq('voided', false).neq('department', 'b2b').order('id').range(a, b)),
    all<{ stat_date: string; manager: string; metric: string; value: number }>((a, b) => sb.from('manager_stats_daily')
      .select('stat_date, manager, metric, value').gte('stat_date', moneyFrom).lte('stat_date', moneyTo)
      .in('metric', BOOK_METRICS).order('stat_date').order('manager').order('metric').range(a, b)),
    split.months.length
      ? all<{ manager: string; metric: string; value: number }>((a, b) => sb.from('manager_stats_monthly')
        .select('manager, metric, value').in('month', split.months).in('metric', BOOK_METRICS).order('month').order('manager').order('metric').range(a, b))
      : Promise.resolve({ data: [] as { manager: string; metric: string; value: number }[], error: null }),
    // Один месяц, две метрики — по строке на человека книги (07.10 — 37 строк на месяц всего).
    moneyMonth
      ? sb.from('manager_stats_monthly').select('value').eq('month', prevMonth(moneyMonth)).in('metric', ['prepay', 'remainder']).limit(1000)
      : Promise.resolve({ data: null, error: null }),
    sb.from('manager_stats_daily').select('stat_date').neq('value', 0).order('stat_date', { ascending: false }).limit(1).maybeSingle(),
  ])
  note('снимки дней', snap.error); note('планы', plans.error); note('продажи', sales.error)
  note('книга по дням', daily.error); note('книга по месяцам', monthly.error); note('прошлый месяц', prevMonthly.error)

  const planOf = (m: string | null, id: number) => {
    if (!m) return null
    const p = (plans.data ?? []).find(x => x.month === m && Number(x.amo_user_id) === id)
    return p?.plan_money != null ? Number(p.plan_money) : null
  }

  const rows = snap.data
  const days = [...new Set(rows.map(r => r.day))].sort()
  const userName = new Map(((users.data ?? []) as { name: string | null; amo_user_id: number }[]).map(u => [Number(u.amo_user_id), u.name ?? '']))
  const owner = new Map<string, number>()
  const people: TeamPerson[] = sellers.map(id => {
    const s = schedules.get(id)
    const name = s?.name ?? userName.get(id) ?? `amo #${id}`
    for (const n of [...bookNames(name), ...bookNames(userName.get(id) ?? '')]) owner.set(n, id)
    const mine = rows.filter(r => Number(r.amo_user_id) === id)
    return {
      amoUserId: id, name, schedule: s,
      row: day ? mine.find(r => r.day === day) : undefined,
      act: sumActivity(mine, s, days),
      money: emptyMonth(),
      plan: planOf(moneyMonth, id), planNow: planOf(planMonth, id), planNext: planOf(nextMonth(planMonth), id),
    }
  })
  const byId = new Map(people.map(p => [p.amoUserId, p]))
  const otherMoney = emptyMonth()
  const otherNames = new Set<string>()
  const target = (manager: string): MonthMoney => {
    const p = byId.get(owner.get(manager) ?? -1)
    if (p) return p.money
    otherNames.add(manager)
    return otherMoney
  }

  for (const s of sales.data) {
    const m = target(s.manager)
    m.salesCount++
    m.salesSum += Number(s.amount) || 0
  }
  // Нули в книге не делают человека «другим» в подписи.
  for (const f of daily.data) if (split.daily(f.stat_date) && Number(f.value)) addBookFacts(target(f.manager), [f])
  for (const f of monthly.data) if (Number(f.value)) addBookFacts(target(f.manager), [f])

  const touched = otherMoney.salesCount + otherMoney.prepay + otherMoney.remainder + otherMoney.talks + otherMoney.payments > 0
  const updatedAt = day ? rows.filter(r => r.day === day).map(r => r.updated_at ?? '').sort().at(-1) || null : null

  return {
    today, view,
    act: { from: actFrom, to: actTo, day, days, firstSnapshot, updatedAt },
    money: {
      from: moneyFrom, to: moneyTo, month: moneyMonth,
      prevTotal: prevMonthly.data?.length ? prevMonthly.data.reduce((s, r) => s + (Number(r.value) || 0), 0) : null,
    },
    bookLastDay: (last.data?.stat_date as string | undefined) ?? null,
    people,
    others: touched ? { names: [...otherNames].sort(), money: otherMoney } : null,
    planMonth,
    errors,
  }
}
