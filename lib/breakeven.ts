// Точки безубыточности финмодели (finplan_models.data) — единственный расчёт.
// Им пользуются /cfo/breakeven, /cfo/model, финнеделя, цех (/production-app/money)
// и /ceo. Маршрут: docs/FINMODEL_MANAGER_ROUTE.md, этапы Ф1–Ф2.
//
// Фонды и доход собственника задаются долей маржи: это распределение уже созданной
// маржи, а не операционные расходы. Доля — в знаменателе, фиксированная сумма
// собственника — в числителе.

export type BreakevenModel = {
  incomes: { name: string; plan: number; vars: { name: string; pct: number }[] }[]
  funds: { invest: number; training: number; reserve: number; prodBonus: number }
  ownerPct: number
  ownerRub: number
  overflowBonusPct: number
  fixed: FixedRow[]
}

// Тип статьи постоянных (ТЗ 1.4). Хранится в finplan_models только после «Сохранить»
// владельца; до этого экран показывает предложение по названию (suggestKind).
export type FixedKind = 'fixed' | 'step' | 'variable' | 'obligation'

export type FixedRow = {
  name: string
  amount: number          // платёж в месяц, ₽ — как уходят деньги
  kind?: FixedKind
  // Только для денежных обязательств (кредит, лизинг). Проценты = платёж − тело.
  body?: number           // погашение тела долга в платеже, ₽/мес
  amortization?: number   // амортизация предмета лизинга, ₽/мес — расход P&L без движения денег
}

export const FIXED_KIND_LABELS: Record<FixedKind, string> = {
  fixed: 'постоянный',
  step: 'ступенчато-постоянный',
  variable: 'по сути переменный',
  obligation: 'денежное обязательство',
}

export type BreakevenTargets = {
  revenue: number
  marginPct: number        // %, одна десятая
  tb0: number | null
  tb1: number | null
  tbTarget: number | null
}

export const BREAKEVEN_LABELS = {
  tb0: 'Операционная точка безубыточности',
  tb1: 'Целевая выручка с фондами',
  tbTarget: 'Целевая выручка с доходом собственника',
} as const

export const BREAKEVEN_HINTS = {
  tb0: 'Маржинальная прибыль покрывает постоянные расходы — работаем в ноль.',
  tb1: 'Плюс отчисления в фонды: возврат инвестиций, обучение, резерв, бонусы.',
  tbTarget: 'Плюс доход собственника — процент от маржи и фиксированная сумма.',
} as const

export const DISTRIBUTION_NOTE =
  'Фонды и доход собственника — не операционные расходы, а правила распределения денег после того, как маржа создана.'

// Статья долга по названию — только для предложения типа. Сохранённый kind важнее:
// иначе переименованная статья тихо перестала бы считаться долгом.
export const isDebtRow = (name: string) => /кредит|лизинг/i.test(name)

// Предложение типа по названию — не решение: владелец подтверждает сохранением.
export function suggestKind(name: string): FixedKind {
  if (isDebtRow(name)) return 'obligation'
  if (/оклад|зп|зарплат/i.test(name)) return 'step'
  if (/банковск|эквайринг|транспорт|логистик|доставк/i.test(name)) return 'variable'
  return 'fixed'
}

export function kindOf(f: FixedRow): { kind: FixedKind; suggested: boolean } {
  return f.kind ? { kind: f.kind, suggested: false } : { kind: suggestKind(f.name), suggested: true }
}

export type FixedSplit = {
  cash: number            // все платежи в месяц — сколько денег уходит
  pnl: number             // расходы P&L: без тела долга, с амортизацией
  opex: number            // постоянные без обязательств
  interest: number        // проценты по обязательствам (платёж − тело)
  body: number            // тело долга
  amortization: number
  unsplit: string[]       // обязательства, у которых тело не отделено — вся сумма в P&L
}

// Тело долга — не расход, а возврат денег: в операционную ТБ не входит (ТЗ 1.3).
// Пока тело не отделено, платёж целиком остаётся в P&L — цифры как раньше, но с предупреждением.
export function splitFixed(fixed: FixedRow[]): FixedSplit {
  const r: FixedSplit = { cash: 0, pnl: 0, opex: 0, interest: 0, body: 0, amortization: 0, unsplit: [] }
  for (const f of fixed ?? []) {
    const amount = f.amount || 0
    r.cash += amount
    if (kindOf(f).kind !== 'obligation') { r.opex += amount; r.pnl += amount; continue }
    const split = f.body != null || f.amortization != null
    if (!split) r.unsplit.push(f.name)
    const body = Math.min(Math.max(f.body || 0, 0), amount)
    const amort = Math.max(f.amortization || 0, 0)
    r.body += body
    r.interest += amount - body
    r.amortization += amort
    r.pnl += amount - body + amort
  }
  return r
}

// Выручка, при которой маржа покрывает постоянные, заданную долю маржи и фиксированную сумму.
// marginPct и marginShare — доли (0..1).
export function revenueToCover(fixed: number, marginPct: number, marginShare = 0, extraRub = 0): number | null {
  const denom = marginPct * (1 - marginShare)
  return denom > 0 ? Math.round((fixed + extraRub) / denom) : null
}

const fundsShareOf = (f: Partial<BreakevenModel['funds']> | undefined) =>
  ((f?.invest || 0) + (f?.training || 0) + (f?.reserve || 0) + (f?.prodBonus || 0)) / 100

export type BreakevenAnalysis = {
  revenue: number
  perIncome: { varPct: number; varRub: number; margin: number; marginPct: number }[]
  margin: number
  marginPct: number        // доля 0..1
  fundsShare: number       // доля маржи 0..1
  fundsRub: number
  ownerRub: number         // доход собственника при плановой выручке: % от маржи + фикс
  distributable: number    // маржа − фонды
  fixed: number            // все платежи в месяц
  split: FixedSplit
  remainder: number        // маржа − фонды − собственник − постоянные
  overflow: number
  overflowBonus: number
  tb0: number | null      // операционная: расходы P&L без тела долга
  tbCash: number | null   // та же, но с платежами по телу долга
  tb1: number | null
  tbTarget: number | null
}

export function analyzeBreakeven(m: BreakevenModel): BreakevenAnalysis {
  const incomes = m.incomes ?? []
  const revenue = incomes.reduce((s, i) => s + (i.plan || 0), 0)
  const perIncome = incomes.map(inc => {
    const varPct = (inc.vars ?? []).reduce((a, v) => a + (v.pct || 0), 0) / 100
    const varRub = (inc.plan || 0) * varPct
    return { varPct, varRub, margin: (inc.plan || 0) - varRub, marginPct: 1 - varPct }
  })
  const margin = perIncome.reduce((s, x) => s + x.margin, 0)
  const marginPct = revenue > 0 ? margin / revenue : 0
  const fundsShare = fundsShareOf(m.funds)
  const fundsRub = margin * fundsShare
  const ownerShare = (m.ownerPct || 0) / 100
  const ownerRub = margin * ownerShare + (m.ownerRub || 0)
  const split = splitFixed(m.fixed ?? [])
  const fixed = split.cash
  const remainder = margin - fundsRub - ownerRub - fixed
  const overflow = Math.max(0, remainder)

  return {
    revenue, perIncome, margin, marginPct, fundsShare, fundsRub, ownerRub,
    distributable: margin - fundsRub,
    fixed, split, remainder, overflow,
    overflowBonus: overflow * (m.overflowBonusPct || 0) / 100,
    // Целевые выручки — денежные: фонды и собственник получают то, что осталось после всех платежей
    tb0: revenueToCover(split.pnl, marginPct),
    tbCash: revenueToCover(split.cash, marginPct),
    tb1: revenueToCover(fixed, marginPct, fundsShare),
    tbTarget: revenueToCover(fixed, marginPct, fundsShare + ownerShare, m.ownerRub || 0),
  }
}

export function computeBreakeven(m: BreakevenModel): BreakevenTargets {
  const a = analyzeBreakeven(m)
  return {
    revenue: a.revenue,
    marginPct: Math.round(a.marginPct * 1000) / 10,
    tb0: a.tb0, tb1: a.tb1, tbTarget: a.tbTarget,
  }
}

const marginOf = (m: BreakevenModel) => analyzeBreakeven(m).margin

// «Компания» = сумма юнитов. Доходы и постоянные складываются; доли фондов и
// собственника — взвешенные по марже юнитов, чтобы рубли сводки равнялись сумме юнитов.
export function combineUnits(units: BreakevenModel[]): BreakevenModel {
  const margins = units.map(marginOf)
  const mSum = margins.reduce((s, x) => s + x, 0)
  const weighted = (pick: (u: BreakevenModel) => number) =>
    mSum > 0 ? units.reduce((s, u, i) => s + margins[i] * (pick(u) || 0), 0) / mSum : 0
  return {
    incomes: units.flatMap(u => structuredClone(u.incomes ?? [])),
    funds: {
      invest: weighted(u => u.funds?.invest),
      training: weighted(u => u.funds?.training),
      reserve: weighted(u => u.funds?.reserve),
      prodBonus: weighted(u => u.funds?.prodBonus),
    },
    ownerPct: weighted(u => u.ownerPct),
    ownerRub: units.reduce((s, u) => s + (u.ownerRub || 0), 0),
    overflowBonusPct: 0,
    fixed: units.flatMap(u => structuredClone(u.fixed ?? [])),
  }
}

export function withoutDebt(m: BreakevenModel): BreakevenModel {
  return { ...m, fixed: (m.fixed ?? []).filter(f => kindOf(f).kind !== 'obligation') }
}
