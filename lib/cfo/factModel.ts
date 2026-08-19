// Чистая финмодель для /cfo/model: P&L и сценарии. Без Supabase/React.
// Направления, VC%, налоговые режимы и фонды — та же логика, что на /admin/cfo,
// вынесенная сюда, чтобы вкладки Факт/Сценарии и будущая консолидация CFO
// считали из одного источника.

export type TaxSystem = 'usn_6' | 'usn_15' | 'osno'

export type RevenueLine = {
  id: string
  label: string
  vcPct: number        // переменные затраты, % от выручки
  revenue: number      // ₽/мес
  isActual: boolean    // true — из реальных данных, false — план/дефолт
}

export type FixedCostLine = {
  key: string
  label: string
  amount: number       // ₽/мес
  isFinancing: boolean // лизинг/кредит — долговая нагрузка, отключается в сценариях
}

export type ProfitSplit = { owner: number; education: number; reserve: number }

export type PnlInput = {
  revenueLines: RevenueLine[]
  fixedCosts: FixedCostLine[]
  taxSystem: TaxSystem
  profitSplit: ProfitSplit
  insuranceMonthly: number
}

export type Pnl = {
  revenue: number
  variableCost: number
  contribution: number
  contributionPct: number
  weightedVcPct: number
  fixedTotal: number
  ebitda: number
  ebitdaPct: number
  tax: number
  insurance: number
  netProfit: number
  netPct: number
  fundsOwner: number
  fundsEducation: number
  fundsReserve: number
  retained: number
  tb0: number | null   // выручка «в ноль» без фондов
  tb1: number | null   // с распределением фондов
}

export const REV_DIRECTIONS = [
  { id: 'b2c_mirror',   label: 'Зеркала / перегородки (B2C)', vcPct: 62 },
  { id: 'b2c_shower',   label: 'Душевые кабины (B2C)',        vcPct: 62 },
  { id: 'b2c_loft',     label: 'Лофт-перегородки (B2C)',      vcPct: 62 },
  { id: 'b2c_services', label: 'Монтаж и доставка',           vcPct: 25 },
  { id: 'b2b_glass',    label: 'B2B Стекло / Металл',         vcPct: 49 },
  { id: 'other',        label: 'Прочие доходы',               vcPct: 40 },
] as const

export const FC_LABELS: Record<string, string> = {
  rent:        'Аренда',
  utilities:   'Коммунальные',
  payroll:     'ФОТ (зарплата)',
  payroll_tax: 'Налоги на ФОТ',
  leasing:     'Лизинг',
  credit:      'Кредиты и проценты',
  marketing:   'Маркетинг и реклама',
  outsource:   'Аутсорс, ПО, банк',
  other:       'Прочее',
}

export const FINANCING_KEYS = ['leasing', 'credit']

const r = (n: number) => Math.round(n)

function computeTax(
  taxSystem: TaxSystem,
  revenue: number,
  variableCost: number,
  fixedTotal: number,
  insuranceMonthly: number,
): { tax: number; insurance: number } {
  if (taxSystem === 'usn_15') {
    const base = Math.max(revenue - variableCost - fixedTotal, 0)
    return { tax: Math.max(base * 0.15, revenue * 0.01), insurance: insuranceMonthly }
  }
  if (taxSystem === 'osno') {
    const vatOut = revenue * (20 / 120)
    const vatIn = variableCost * 0.7 * (20 / 120)
    const pBefore = (revenue - vatOut) - (variableCost - vatIn) - fixedTotal
    return { tax: Math.max(pBefore * 0.2, 0), insurance: 0 }
  }
  // usn_6 (по умолчанию): 6% с дохода минус страховые (до 50%)
  const raw = revenue * 0.06
  const deduct = Math.min(insuranceMonthly, raw * 0.5)
  return { tax: raw - deduct, insurance: insuranceMonthly }
}

export function computePnl(input: PnlInput, excludedFixedKeys: string[] = []): Pnl {
  const excluded = new Set(excludedFixedKeys)
  const revenue = input.revenueLines.reduce((s, x) => s + x.revenue, 0)
  const variableCost = input.revenueLines.reduce((s, x) => s + x.revenue * (x.vcPct / 100), 0)
  const contribution = revenue - variableCost
  const fixedTotal = input.fixedCosts.reduce((s, f) => s + (excluded.has(f.key) ? 0 : f.amount), 0)
  const ebitda = contribution - fixedTotal

  const { tax, insurance } = computeTax(input.taxSystem, revenue, variableCost, fixedTotal, input.insuranceMonthly)
  const netProfit = ebitda - tax - insurance

  const ps = input.profitSplit
  const pos = netProfit > 0 ? netProfit : 0
  const fundsOwner = pos * (ps.owner / 100)
  const fundsEducation = pos * (ps.education / 100)
  const fundsReserve = pos * (ps.reserve / 100)
  const retained = netProfit - fundsOwner - fundsEducation - fundsReserve

  const weightedVc = revenue > 0 ? variableCost / revenue : 0
  const marginPct = 1 - weightedVc
  const fundsPct = (ps.owner + ps.education + ps.reserve) / 100
  const tb0 = marginPct > 0 ? r(fixedTotal / marginPct) : null
  const tb1 = marginPct > 0 && 1 - fundsPct > 0 ? r(fixedTotal / (marginPct * (1 - fundsPct))) : null

  return {
    revenue: r(revenue),
    variableCost: r(variableCost),
    contribution: r(contribution),
    contributionPct: revenue > 0 ? Math.round((contribution / revenue) * 1000) / 10 : 0,
    weightedVcPct: Math.round(weightedVc * 1000) / 10,
    fixedTotal: r(fixedTotal),
    ebitda: r(ebitda),
    ebitdaPct: revenue > 0 ? Math.round((ebitda / revenue) * 1000) / 10 : 0,
    tax: r(tax),
    insurance: r(insurance),
    netProfit: r(netProfit),
    netPct: revenue > 0 ? Math.round((netProfit / revenue) * 1000) / 10 : 0,
    fundsOwner: r(fundsOwner),
    fundsEducation: r(fundsEducation),
    fundsReserve: r(fundsReserve),
    retained: r(retained),
    tb0,
    tb1,
  }
}

export type ScenarioPreset = { id: string; label: string; excluded: string[] }

export function scenarioPresets(fixedCosts: FixedCostLine[]): ScenarioPreset[] {
  const fin = fixedCosts.filter((f) => f.isFinancing).map((f) => f.key)
  return [
    { id: 'fact',   label: 'Как есть (факт)',        excluded: [] },
    { id: 'nodebt', label: 'Без лизинга и кредита',  excluded: fin },
    { id: 'lean',   label: 'Только операционные',    excluded: [...fin, 'marketing', 'outsource'] },
  ]
}
