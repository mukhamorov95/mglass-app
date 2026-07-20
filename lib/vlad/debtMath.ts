// Детерминированная математика долгов — чистый TS, без LLM (правило проекта).
// Модель: помесячная симуляция. Проценты начисляются на остаток (rate/12),
// платёж сначала гасит проценты, остаток платежа — тело. Досрочные деньги
// (extra) идут целиком в тело долга, выбранного стратегией.

export type Obligation = {
  id: number
  creditor: string
  kind: string
  principal: number
  rate_pct: number
  monthly_payment: number
  due_day: number | null
  note: string | null
  closed_at: string | null
}

export type PayoffStrategy = 'avalanche' | 'snowball'
// avalanche — сначала самая высокая ставка (дешевле всего по деньгам)
// snowball  — сначала самый маленький долг (быстрые закрытия, видимые победы)

export type PayoffResult = {
  months: number            // месяцев до полной свободы (999+ = недостижимо)
  totalInterest: number     // сколько всего уйдёт на проценты, ₽
  freedomDate: string       // ISO-дата свободы
  closures: { creditor: string; month: number }[]  // порядок закрытий
  stuck: string[]           // долги, где платёж не покрывает проценты
}

const MAX_MONTHS = 600

export function monthlyLoad(obs: Obligation[]): number {
  return obs.filter(o => !o.closed_at).reduce((s, o) => s + o.monthly_payment, 0)
}

export function totalDebt(obs: Obligation[]): number {
  return obs.filter(o => !o.closed_at).reduce((s, o) => s + o.principal, 0)
}

export function simulatePayoff(
  obs: Obligation[],
  strategy: PayoffStrategy,
  extraPerMonth: number,
  startISO: string,
  // Стратегия владельца «каждый месяц отдавать больше»: досрочка растёт на
  // rampPerMonth каждый месяц (мес.1 = extra, мес.2 = extra + ramp, …).
  rampPerMonth = 0,
): PayoffResult {
  type Live = { creditor: string; balance: number; rate: number; payment: number }
  let live: Live[] = obs
    .filter(o => !o.closed_at && o.principal > 0)
    .map(o => ({ creditor: o.creditor, balance: o.principal, rate: o.rate_pct / 100 / 12, payment: o.monthly_payment }))

  const stuck = live
    .filter(l => l.payment + extraPerMonth <= l.balance * l.rate)
    .map(l => l.creditor)

  const closures: PayoffResult['closures'] = []
  let totalInterest = 0
  let month = 0
  let freed = 0  // платежи уже закрытых долгов — автоматически усиливают досрочку

  while (live.length > 0 && month < MAX_MONTHS) {
    month++
    let pool = extraPerMonth + rampPerMonth * (month - 1) + freed

    for (const l of live) {
      const interest = l.balance * l.rate
      totalInterest += interest
      const toBody = Math.max(0, l.payment - interest)
      l.balance = Math.max(0, l.balance + interest - l.payment)
      if (toBody === 0 && l.payment < interest) {
        // платёж не покрыл проценты — долг растёт; ловится через stuck
      }
    }

    // досрочка — в один долг по стратегии
    if (pool > 0 && live.length > 0) {
      const sorted = [...live].sort((a, b) =>
        strategy === 'avalanche' ? b.rate - a.rate : a.balance - b.balance)
      for (const target of sorted) {
        if (pool <= 0) break
        const pay = Math.min(pool, target.balance)
        target.balance -= pay
        pool -= pay
      }
    }

    const closedNow = live.filter(l => l.balance <= 0.5)
    for (const c of closedNow) closures.push({ creditor: c.creditor, month })
    if (closedNow.length > 0) {
      // платёж закрытого долга переходит в досрочку следующих месяцев
      freed += closedNow.reduce((s, c) => s + c.payment, 0)
      live = live.filter(l => l.balance > 0.5)
    }
  }

  const d = new Date(startISO)
  d.setMonth(d.getMonth() + month)
  return {
    months: month,
    totalInterest: Math.round(totalInterest),
    freedomDate: d.toISOString().slice(0, 10),
    closures,
    stuck,
  }
}
