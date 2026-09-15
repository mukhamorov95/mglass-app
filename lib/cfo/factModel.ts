// Чистая финмодель для /cfo/model. Источник правды — «Точка безубыточности»
// (finplan_models): два юнита M-Glass и Производство, их доходы (план), переменные
// (VC% = сумма статей), постоянные расходы и фонды. Налог уже сидит внутри VC
// (УСН/НДС статьями), поэтому отдельно не начисляется. ТБ считает lib/breakeven.ts —
// та же функция, что на /cfo/breakeven.
//
// EBITDA считаем корректно — ДО обслуживания долга: кредит и лизинг вынесены из
// постоянных отдельной строкой. Маржа − постоянные_без_долга = EBITDA; минус долг
// = операционная прибыль.

import { revenueToCover } from '../breakeven'
export { isDebtRow } from '../breakeven'

export type IncomeLine = {
  id: string
  label: string
  unit: string        // 'M-Glass' | 'Производство'
  plan: number        // ₽/мес — плановый доход
  vcPct: number       // переменные, % от дохода (сумма статей)
}

export type FixedLine = {
  key: string
  label: string
  unit: string
  amount: number      // ₽/мес
  isDebt: boolean     // кредит/лизинг — обслуживание долга
}

export type BeInput = {
  incomes: IncomeLine[]
  fixed: FixedLine[]
  fundsRub: number    // фонды из маржи, ₽ (от постоянных не зависят)
  ownerPctRub?: number   // доход собственника в % от маржи, пересчитанный в ₽ при плане
  ownerFixedRub?: number // доход собственника фиксированной суммой, ₽/мес
}

export type BePnl = {
  revenue: number
  variableCost: number
  margin: number
  marginPct: number
  fixedNoDebt: number  // постоянные без кредита/лизинга
  debtTotal: number    // кредит + лизинг
  fixedTotal: number   // всё постоянное
  ebitda: number       // маржа − постоянные без долга (прибыль ДО обслуживания долга)
  ebitdaPct: number
  operating: number    // EBITDA − долг (операционная прибыль после долга)
  operatingPct: number
  fundsRub: number
  ownerRub: number     // доход собственника при плановом доходе
  remainder: number    // прибыль после долга − фонды − собственник (как «Остаток» на break-even)
  tb0: number | null      // операционная точка безубыточности
  tb1: number | null      // целевая выручка с фондами
  tbTarget: number | null // целевая выручка с доходом собственника
}

const r = (n: number) => Math.round(n)

export function computeBe(input: BeInput, excludedFixedKeys: string[] = []): BePnl {
  const excluded = new Set(excludedFixedKeys)
  const revenue = input.incomes.reduce((s, i) => s + i.plan, 0)
  const variableCost = input.incomes.reduce((s, i) => s + i.plan * (i.vcPct / 100), 0)
  const margin = revenue - variableCost
  const marginPct = revenue > 0 ? margin / revenue : 0

  let fixedNoDebt = 0
  let debtTotal = 0
  for (const f of input.fixed) {
    if (excluded.has(f.key)) continue
    if (f.isDebt) debtTotal += f.amount
    else fixedNoDebt += f.amount
  }
  const fixedTotal = fixedNoDebt + debtTotal

  const ebitda = margin - fixedNoDebt
  const operating = margin - fixedTotal
  const fundsRub = input.fundsRub
  const ownerRub = (input.ownerPctRub ?? 0) + (input.ownerFixedRub ?? 0)
  const remainder = operating - fundsRub - ownerRub

  const fundsShare = margin > 0 ? fundsRub / margin : 0
  const ownerShare = margin > 0 ? (input.ownerPctRub ?? 0) / margin : 0
  const tb0 = revenueToCover(fixedTotal, marginPct)
  const tb1 = revenueToCover(fixedTotal, marginPct, fundsShare)
  const tbTarget = revenueToCover(fixedTotal, marginPct, fundsShare + ownerShare, input.ownerFixedRub ?? 0)

  return {
    revenue: r(revenue),
    variableCost: r(variableCost),
    margin: r(margin),
    marginPct: revenue > 0 ? Math.round(marginPct * 1000) / 10 : 0,
    fixedNoDebt: r(fixedNoDebt),
    debtTotal: r(debtTotal),
    fixedTotal: r(fixedTotal),
    ebitda: r(ebitda),
    ebitdaPct: revenue > 0 ? Math.round((ebitda / revenue) * 1000) / 10 : 0,
    operating: r(operating),
    operatingPct: revenue > 0 ? Math.round((operating / revenue) * 1000) / 10 : 0,
    fundsRub: r(fundsRub),
    ownerRub: r(ownerRub),
    remainder: r(remainder),
    tb0,
    tb1,
    tbTarget,
  }
}

export type ScenarioPreset = { id: string; label: string; excluded: string[] }

export function scenarioPresets(fixed: FixedLine[]): ScenarioPreset[] {
  const debt = fixed.filter((f) => f.isDebt).map((f) => f.key)
  return [
    { id: 'fact',   label: 'Как есть',              excluded: [] },
    { id: 'nodebt', label: 'Без кредита и лизинга', excluded: debt },
  ]
}
