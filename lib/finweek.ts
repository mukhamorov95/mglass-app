// Финнеделя владельца (Б3): неделя = ЧЕТВЕРГ включительно → СРЕДА включительно.
// Неделя принадлежит месяцу, в котором её четверг. Месячный план (из точки
// безубыточности /cfo/breakeven) делится на недели поровну; недобор завершённой
// недели делится на оставшиеся недели месяца и ДОБАВЛЯЕТСЯ к их плану,
// перевыполнение — вычитается. Поступления недели наполняют фонды waterfall
// сверху вниз (переменные → постоянные → фонды) по процентам финмодели.
// Модуль чистый: никаких Date.now/new Date() без аргументов — дата приходит параметром.

import { incomeOf, signedSums } from '@/lib/accounting/fundSign'

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

export type CashEntryLike = { entry_date: string; kind: string; fund_id: number; amount: number }
export type FundAvail = { allocated: number; spent: number; available: number }

// Поступления финнедели — знаковая сумма фондов «Поступлений» (lib/accounting/fundSign):
// возврат клиенту вычитается, а кредит или возврат от поставщика на расходном фонде
// выручкой не считается и по фондам не разливается.
export function weekIncome(entries: CashEntryLike[], funds: FundLike[], w: FinWeek): number {
  return incomeOf(entries.filter(e => inWeek(e.entry_date, w)), funds)
}

// Точный остаток фондов: waterfall по каждой финнеделе месяца по фактическим
// поступлениям, минус расходы фонда за те же недели. Расход — со знаком: приход на
// фонд (возврат от поставщика, сторно) его уменьшает.
export function fundAvailability(weeks: FinWeek[], entries: CashEntryLike[], funds: FundLike[]): Map<number, FundAvail> {
  const acc = new Map<number, FundAvail>()
  const get = (id: number) => acc.get(id) ?? { allocated: 0, spent: 0, available: 0 }
  for (const w of weeks) {
    for (const f of waterfall(weekIncome(entries, funds, w), funds).fills) {
      const cur = get(f.id)
      cur.allocated += f.allocated
      acc.set(f.id, cur)
    }
  }
  const inMonth = entries.filter(e => weeks.some(w => inWeek(e.entry_date, w)))
  for (const [id, v] of signedSums(inMonth, funds.filter(f => f.fund_class !== 'income')).byFund) {
    const cur = get(id)
    cur.spent += v
    acc.set(id, cur)
  }
  for (const v of acc.values()) v.available = v.allocated - v.spent
  return acc
}
