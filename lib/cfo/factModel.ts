// Чистая финмодель для /cfo/model. Источник правды — «Точка безубыточности»
// (finplan_models): два юнита M-Glass и Производство, их доходы (план), переменные
// (VC% = сумма статей), постоянные расходы и фонды. Налог уже сидит внутри VC
// (УСН/НДС статьями), поэтому отдельно не начисляется. Та же математика ТБ, что
// в lib/breakeven.ts и на странице /cfo/breakeven.
//
// EBITDA считаем корректно — ДО обслуживания долга: кредит и лизинг вынесены из
// постоянных отдельной строкой. Маржа − постоянные_без_долга = EBITDA; минус долг
// = операционная прибыль.

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
  remainder: number    // операционная прибыль − фонды (как «Остаток» на break-even)
  tb0: number | null   // ТБ-0: доход «в ноль» без фондов (все постоянные)
  tb1: number | null   // ТБ-1: с фондами
}

export const isDebtRow = (name: string) => /кредит|лизинг/i.test(name)

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
  const remainder = operating - fundsRub

  const fundsPct = margin > 0 ? fundsRub / margin : 0
  const tb0 = marginPct > 0 ? r(fixedTotal / marginPct) : null
  const tb1 = marginPct > 0 && 1 - fundsPct > 0 ? r(fixedTotal / (marginPct * (1 - fundsPct))) : null

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
    remainder: r(remainder),
    tb0,
    tb1,
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
