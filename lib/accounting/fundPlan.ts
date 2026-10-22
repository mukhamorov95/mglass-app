// Состав фонда ДДС (владелец 22.10.2026): у подфонда — план в месяц (оклад человека,
// аренда и т.п.), план фонда — сумма планов его подфондов. Нет ни одного плана — плана нет.

export function fundPlan(subIds: number[], plans: Map<number, number>): number | null {
  let sum = 0, any = false
  for (const id of subIds) {
    const v = plans.get(id)
    if (v != null) { sum += v; any = true }
  }
  return any ? Math.round(sum * 100) / 100 : null
}

// Ввод суммы: «80 000», «80000,5» → число; пусто → null (план снят); иное → NaN.
export function parsePlan(raw: string): number | null {
  const t = raw.replace(/\s/g, '').replace(',', '.')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN
}
