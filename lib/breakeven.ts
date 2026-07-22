// Расчёт точек безубыточности из финмодели (finplan_models.data). Чистая
// функция — тот же расчёт, что на /cfo/breakeven, но переиспользуемый сервером
// (подстановка месячного плана финнедели из ТБ).

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
  marginPct: number
  tb0: number | null   // выручка «в ноль» без фондов
  tb1: number | null   // с фондами
  tbTarget: number | null // с доходом собственника
}

export function computeBreakeven(m: BreakevenModel): BreakevenTargets {
  const incomes = m.incomes ?? []
  const revenue = incomes.reduce((s, i) => s + (i.plan || 0), 0)
  const margin = incomes.reduce((s, inc) => {
    const varPct = (inc.vars ?? []).reduce((a, v) => a + (v.pct || 0), 0) / 100
    return s + (inc.plan || 0) * (1 - varPct)
  }, 0)
  const weightedMarginPct = revenue > 0 ? margin / revenue : 0
  const f = m.funds ?? { invest: 0, training: 0, reserve: 0, prodBonus: 0 }
  const fundsPct = ((f.invest || 0) + (f.training || 0) + (f.reserve || 0) + (f.prodBonus || 0)) / 100
  const fixed = (m.fixed ?? []).reduce((s, x) => s + (x.amount || 0), 0)

  const be = (fPct: number, oPct: number, oRub: number): number | null => {
    const denom = weightedMarginPct * (1 - fPct - oPct / 100)
    return denom > 0 ? Math.round((fixed + oRub) / denom) : null
  }

  return {
    revenue, marginPct: Math.round(weightedMarginPct * 1000) / 10,
    tb0: be(0, 0, 0),
    tb1: be(fundsPct, 0, 0),
    tbTarget: be(fundsPct, m.ownerPct || 0, m.ownerRub || 0),
  }
}
