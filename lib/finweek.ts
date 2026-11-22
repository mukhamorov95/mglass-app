// Финнеделя владельца (Б3): неделя = ЧЕТВЕРГ включительно → СРЕДА включительно.
// Неделя принадлежит месяцу, в котором её четверг. Месячный план (из точки
// безубыточности /cfo/breakeven) делится на недели поровну; недобор завершённой
// недели делится на оставшиеся недели месяца и ДОБАВЛЯЕТСЯ к их плану,
// перевыполнение — вычитается. Поступления недели наполняют фонды waterfall
// сверху вниз (переменные → постоянные → фонды) по процентам финмодели.
// Модуль чистый: никаких Date.now/new Date() без аргументов — дата приходит параметром.

export type FinWeek = { start: string; end: string }

const DAY = 86_400_000
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
const ts = (d: string) => Date.parse(d + 'T00:00:00Z')

export function finWeeksOfMonth(ym: string): FinWeek[] {
  const [y, m] = ym.split('-').map(Number)
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const weeks: FinWeek[] = []
  for (let d = 0; d < daysIn; d++) {
    const t = Date.UTC(y, m - 1, 1) + d * DAY
    if (new Date(t).getUTCDay() === 4) weeks.push({ start: iso(t), end: iso(t + 6 * DAY) })
  }
  return weeks
}

export function finWeekOf(date: string): FinWeek {
  const t = ts(date)
  const back = (new Date(t).getUTCDay() - 4 + 7) % 7
  return { start: iso(t - back * DAY), end: iso(t - back * DAY + 6 * DAY) }
}

export const inWeek = (date: string, w: FinWeek) => date >= w.start && date <= w.end

export type WeekPlan = {
  week: FinWeek
  base: number      // план до пересчётов (месяц / недель)
  plan: number      // план с учётом недоборов/перевыполнений прошлых недель
  fact: number
  deviation: number // fact − plan
  completed: boolean
  current: boolean
}

export function buildWeekPlans(monthPlan: number, weeks: FinWeek[], factByWeek: number[], today: string): WeekPlan[] {
  const base = weeks.length ? monthPlan / weeks.length : 0
  const plans = weeks.map(() => base)
  return weeks.map((w, i) => {
    const completed = today > w.end
    const fact = factByWeek[i] ?? 0
    const plan = plans[i]
    if (completed && i < weeks.length - 1) {
      const rest = weeks.length - 1 - i
      for (let j = i + 1; j < weeks.length; j++) plans[j] += (plan - fact) / rest
    }
    return { week: w, base, plan, fact, deviation: fact - plan, completed, current: inWeek(today, w) }
  })
}

export type FundLike = { id: number; name: string; fund_class: string; percent: number | null; sort: number }
export type FundFill = { id: number; name: string; fund_class: string; percent: number; target: number; allocated: number }

const CLASS_ORDER: Record<string, number> = { variable: 0, fixed: 1, fund: 2 }

export function waterfall(income: number, funds: FundLike[]): { fills: FundFill[]; overflow: number } {
  const ordered = funds
    .filter(f => f.percent != null && f.fund_class in CLASS_ORDER)
    .sort((a, b) => (CLASS_ORDER[a.fund_class] - CLASS_ORDER[b.fund_class]) || (a.sort - b.sort) || (a.id - b.id))
  const inc = Math.max(0, income)
  let pool = inc
  const fills = ordered.map(f => {
    const target = inc * Number(f.percent) / 100
    const allocated = Math.min(target, pool)
    pool -= allocated
    return { id: f.id, name: f.name, fund_class: f.fund_class, percent: Number(f.percent), target, allocated }
  })
  return { fills, overflow: pool }
}

export type CashEntryLike = { entry_date: string; kind: string; fund_id: number; subfund_id?: number | null; amount: number }
export type FundAvail = { allocated: number; spent: number; available: number }

// Точный остаток фондов: waterfall по каждой финнеделе месяца по фактическим
// поступлениям, минус расходы фонда за те же недели.
// Внедоходные поступления (nonIncome — id подфондов) в заливку не идут.
export function fundAvailability(weeks: FinWeek[], entries: CashEntryLike[], funds: FundLike[], nonIncome: ReadonlySet<number> = new Set()): Map<number, FundAvail> {
  const acc = new Map<number, FundAvail>()
  for (const w of weeks) {
    const income = entries.reduce((s, e) => s + (isClientIncome(e, nonIncome) && inWeek(e.entry_date, w) ? Number(e.amount) : 0), 0)
    for (const f of waterfall(income, funds).fills) {
      const cur = acc.get(f.id) ?? { allocated: 0, spent: 0, available: 0 }
      cur.allocated += f.allocated
      acc.set(f.id, cur)
    }
  }
  for (const e of entries) {
    if (e.kind === 'in' || !weeks.some(w => inWeek(e.entry_date, w))) continue
    const cur = acc.get(e.fund_id) ?? { allocated: 0, spent: 0, available: 0 }
    cur.spent += Number(e.amount)
    acc.set(e.fund_id, cur)
  }
  for (const v of acc.values()) v.available = v.allocated - v.spent
  return acc
}

// ─── ТЗ финпланирования 22.11.2026 (docs/finplan/FINPLAN_ROUTE.md, Ф1) ───
// Месяц считает операции по их дате; неделя совещания — все семь дней чт–ср.
// Периоды месяца = финнедели, обрезанные границами месяца, плюс «До конца
// месяца» после последней среды. Деньги — в копейках, чтобы разбивка сходилась.

export type MonthPeriod = { start: string; end: string; week: FinWeek; tail: boolean }

const monthEnd = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return iso(Date.UTC(y, m, 0))
}

export function monthPeriods(ym: string): MonthPeriod[] {
  const first = ym + '-01'
  const last = monthEnd(ym)
  const out: MonthPeriod[] = []
  for (let t = ts(first); t <= ts(last); t += DAY) {
    if (new Date(t).getUTCDay() !== 3) continue
    const week = finWeekOf(iso(t))
    out.push({ start: week.start < first ? first : week.start, end: iso(t), week, tail: false })
  }
  const lastWed = out[out.length - 1]?.end
  if (lastWed && lastWed < last) {
    const start = iso(ts(lastWed) + DAY)
    out.push({ start, end: last, week: finWeekOf(start), tail: true })
  }
  return out
}

// Федеральные нерабочие праздники без постановлений о переносе — переносы правит
// CFO в разбивке (Ф2).
const HOLIDAYS = new Set(['01-01', '01-02', '01-03', '01-04', '01-05', '01-06', '01-07', '01-08', '02-23', '03-08', '05-01', '05-09', '06-12', '11-04'])

export function isWorkday(date: string): boolean {
  const wd = new Date(ts(date)).getUTCDay()
  return wd !== 0 && wd !== 6 && !HOLIDAYS.has(date.slice(5))
}

export function workdays(start: string, end: string): number {
  let n = 0
  for (let t = ts(start); t <= ts(end); t += DAY) if (isWorkday(iso(t))) n++
  return n
}

// Делит целое число копеек по весам методом наибольшего остатка: сумма частей
// равна целому до копейки. Нулевые веса — поровну.
export function splitKopecks(total: number, weights: number[]): number[] {
  if (!weights.length) return []
  const w = weights.some(x => x > 0) ? weights.map(x => Math.max(0, x)) : weights.map(() => 1)
  const sumW = w.reduce((s, x) => s + x, 0)
  const sign = total < 0 ? -1 : 1
  const abs = Math.abs(total)
  const raw = w.map(x => (abs * x) / sumW)
  const parts = raw.map(Math.floor)
  let rest = abs - parts.reduce((s, x) => s + x, 0)
  const order = raw.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => (b.r - a.r) || (a.i - b.i))
  for (const o of order) { if (rest <= 0) break; parts[o.i]++; rest-- }
  return parts.map(p => sign * p)
}

export const toKop = (rub: number) => Math.round(rub * 100)
const toRub = (kop: number) => kop / 100

export type PeriodPlan = {
  period: MonthPeriod
  base: number       // исходный план периода (по рабочим дням)
  plan: number       // цель периода с учётом недобора/опережения прошлых периодов
  fact: number       // деньги клиентов за даты периода
  deviation: number  // fact − plan
  cumBase: number    // по исходному плану к концу периода
  cumFact: number
  completed: boolean
  current: boolean
}

export function buildPeriodPlans(monthPlan: number, periods: MonthPeriod[], factByPeriod: number[], today: string): PeriodPlan[] {
  const total = toKop(monthPlan)
  const weights = periods.map(p => workdays(p.start, p.end))
  const base = splitKopecks(total, weights)
  const plan = [...base]
  const fact = periods.map((_, i) => toKop(factByPeriod[i] ?? 0))
  let cumFact = 0
  let cumBase = 0
  return periods.map((p, i) => {
    cumFact += fact[i]
    cumBase += base[i]
    const completed = today > p.end
    if (completed && i < periods.length - 1) {
      const left = Math.max(0, total - cumFact)
      const next = splitKopecks(left, base.slice(i + 1))
      next.forEach((v, k) => { plan[i + 1 + k] = v })
    }
    return {
      period: p, base: toRub(base[i]), plan: toRub(plan[i]), fact: toRub(fact[i]),
      deviation: toRub(fact[i] - plan[i]), cumBase: toRub(cumBase), cumFact: toRub(cumFact),
      completed, current: today >= p.start && today <= p.end,
    }
  })
}

// Итог «на конец последней завершённой среды»: исходный план нарастающим,
// факт, отставание, сколько осталось и новая цель каждого оставшегося периода.
export type MonthStatus = { asOf: string | null; cumBase: number; cumFact: number; lag: number; remaining: number; nextTargets: number[] }

export function monthStatus(rows: PeriodPlan[], monthPlan: number): MonthStatus {
  const done = rows.filter(r => r.completed)
  const last = done[done.length - 1]
  const cumBase = last?.cumBase ?? 0
  const cumFact = last?.cumFact ?? 0
  return {
    asOf: last?.period.end ?? null,
    cumBase, cumFact,
    lag: toRub(toKop(cumBase) - toKop(cumFact)),
    remaining: toRub(Math.max(0, toKop(monthPlan) - toKop(cumFact))),
    nextTargets: rows.filter(r => !r.completed).map(r => r.plan),
  }
}

// Деньги клиентов против внедоходных (заём, вклад учредителя, возврат от
// поставщика): внедоходные растят остаток, но не план и не заливку фондов.
export type IncomeEntry = { entry_date: string; kind: string; subfund_id?: number | null; amount: number }

export const isClientIncome = (e: IncomeEntry, nonIncome: ReadonlySet<number>) =>
  e.kind === 'in' && !(e.subfund_id != null && nonIncome.has(e.subfund_id))

export function incomeSplit(entries: IncomeEntry[], start: string, end: string, nonIncome: ReadonlySet<number>): { client: number; nonIncome: number } {
  let client = 0
  let other = 0
  for (const e of entries) {
    if (e.kind !== 'in' || e.entry_date < start || e.entry_date > end) continue
    const k = toKop(Number(e.amount))
    if (isClientIncome(e, nonIncome)) client += k
    else other += k
  }
  return { client: toRub(client), nonIncome: toRub(other) }
}
