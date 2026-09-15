// Точки безубыточности финмодели (finplan_models.data) — единственный расчёт.
// Им пользуются /cfo/breakeven, /cfo/model, финнеделя, цех (/production-app/money)
// и /ceo. Маршрут: docs/FINMODEL_MANAGER_ROUTE.md, этап Ф1.
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
  fixed: { name: string; amount: number }[]
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

// Статья долга по названию. Запасной вариант, пока у статьи нет признака типа (этап Ф2):
// переименованная статья перестаёт считаться долгом.
export const isDebtRow = (name: string) => /кредит|лизинг/i.test(name)

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
  fixed: number
  remainder: number        // маржа − фонды − собственник − постоянные
  overflow: number
  overflowBonus: number
  tb0: number | null
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
  const fixed = (m.fixed ?? []).reduce((s, x) => s + (x.amount || 0), 0)
  const remainder = margin - fundsRub - ownerRub - fixed
  const overflow = Math.max(0, remainder)

  return {
    revenue, perIncome, margin, marginPct, fundsShare, fundsRub, ownerRub,
    distributable: margin - fundsRub,
    fixed, remainder, overflow,
    overflowBonus: overflow * (m.overflowBonusPct || 0) / 100,
    tb0: revenueToCover(fixed, marginPct),
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
  return { ...m, fixed: (m.fixed ?? []).filter(f => !isDebtRow(f.name)) }
}
