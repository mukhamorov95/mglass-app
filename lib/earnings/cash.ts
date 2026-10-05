// Деньги менеджера по кассе (решения владельца 05.10: план — в поступлениях, «Мои
// деньги» — от поступлений из «Аналитики дохода»). Чистые функции: тест
// __tests__/earnings/cash.test.ts. Комиссия — calculateProgressiveCommission.

import { calculateProgressiveCommission, type CommissionTier } from '@/lib/earnings/calculateProgressiveCommission'
import { nextMonth, prevMonth } from '@/lib/morning'

export type CashMonth = { month: string; prepay: number; remainder: number; payments: number }
export type CashDay = { date: string; prepay: number; remainder: number }

export const cashOf = (m: { prepay: number; remainder: number }) => m.prepay + m.remainder

const DAY = 86_400_000
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)

// Рабочих дней в отрезке [from, to] включительно по графику (1 = пн … 7 = вс).
export function workdays(from: string, to: string, workDays: number[]): number {
  if (to < from) return 0
  let n = 0
  for (let t = Date.parse(`${from}T12:00:00Z`); t <= Date.parse(`${to}T12:00:00Z`); t += DAY) {
    if (workDays.includes(new Date(t).getUTCDay() || 7)) n++
  }
  return n
}

export function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return iso(Date.UTC(y, m, 0, 12))
}

export type PlanProgress = {
  plan: number | null
  cash: number
  pct: number | null          // выполнено, % плана
  forecast: number | null     // поступит к концу месяца, если темп сохранится
  needPerDay: number | null   // сколько нужно в каждый оставшийся рабочий день
  daysLeft: number            // рабочих дней осталось, сегодня включительно
  dataThrough: string | null  // по какой день книга внесена в этом месяце
}

// Темп считаем только по дням, которые уже внесены в книгу: если книга отстаёт,
// «прошедшие» дни без записей уронили бы прогноз до нуля.
export function planProgress(input: {
  plan: number | null; cash: number; month: string; today: string; bookLastDay: string | null; workDays: number[]
}): PlanProgress {
  const { plan, cash, month, today, bookLastDay, workDays } = input
  const start = `${month}-01`
  const end = monthEnd(month)
  const yesterday = iso(Date.parse(`${today}T12:00:00Z`) - DAY)
  const through = [bookLastDay, yesterday, end].filter((d): d is string => !!d).sort()[0]
  const dataThrough = bookLastDay && through >= start ? through : null
  const passed = dataThrough ? workdays(start, dataThrough, workDays) : 0
  const total = workdays(start, end, workDays)
  const daysLeft = workdays(today > start ? today : start, end, workDays)
  const need = plan != null ? Math.max(0, plan - cash) : null
  return {
    plan, cash,
    pct: plan ? (cash / plan) * 100 : null,
    forecast: passed > 0 ? Math.round((cash / passed) * total) : null,
    needPerDay: need != null && daysLeft > 0 ? Math.round(need / daysLeft) : null,
    daysLeft,
    dataThrough,
  }
}

// Выплаты по правилам: 27-го — за поступления 1–15, 15-го следующего месяца — за
// 16–конец. Ступень считается по накопленной сумме месяца, поэтому вторая выплата —
// это комиссия месяца минус уже начисленная за первую половину.
export function payoutSplit(firstHalfCash: number, monthCash: number, tiers: CommissionTier[]) {
  const first = calculateProgressiveCommission(firstHalfCash, tiers).totalCommission
  const total = calculateProgressiveCommission(monthCash, tiers).totalCommission
  return { first, second: total - first, total }
}

export type Payout = { date: string; from: string; to: string; amount: number }

// Три выплаты вокруг месяца: 15-го — добор за вторую половину прошлого, 27-го — за
// 1–15 текущего, 15-го следующего — добор за его вторую половину. Прошлый месяц целиком —
// итогом книги, его первая половина — по дням.
export function payouts(i: {
  month: string; prevTotal: number; prevFirstHalf: number; monthCash: number; firstHalf: number; tiers: CommissionTier[]
}): Payout[] {
  const prev = prevMonth(i.month)
  const p = payoutSplit(i.prevFirstHalf, i.prevTotal, i.tiers)
  const c = payoutSplit(i.firstHalf, i.monthCash, i.tiers)
  return [
    { date: `${i.month}-15`, from: `${prev}-16`, to: monthEnd(prev), amount: p.second },
    { date: `${i.month}-27`, from: `${i.month}-01`, to: `${i.month}-15`, amount: c.first },
    { date: `${nextMonth(i.month)}-15`, from: `${i.month}-16`, to: monthEnd(i.month), amount: c.second },
  ]
}

// Сколько комиссии принёс день: прирост комиссии месяца от его поступлений.
export function dayCommissions(days: CashDay[], tiers: CommissionTier[]): (CashDay & { cash: number; commission: number })[] {
  let acc = 0
  return [...days].sort((a, b) => a.date.localeCompare(b.date)).map(d => {
    const before = calculateProgressiveCommission(acc, tiers).totalCommission
    acc += cashOf(d)
    return { ...d, cash: cashOf(d), commission: calculateProgressiveCommission(acc, tiers).totalCommission - before }
  })
}
