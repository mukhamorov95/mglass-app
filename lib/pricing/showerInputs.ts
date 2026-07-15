// Единый источник входов для расчёта душевой перегородки.
// И UI-калькулятор (app/calculator/shower), и AI-менеджер (lib/quickCalc → Иван)
// собирают glassCostPerM2 / expensesPercent / себестоимость фурнитуры через ЭТИ
// резолверы — иначе цена AI и живого менеджера расходятся (было ×1.78 из-за
// разных источников расходов и стекла). Не дублировать логику на местах.

export type GlassMatrixMap = Record<string, Record<string, number | null>>

export type FinSettingRow = {
  product_type: string | null
  tier: string | null
  tax_percent: number | null
}

export type BudgetManualPrice = { model_id: string; color_id: number; price: number }
export type HwColorRow = { id: number; name: string }
export type MaterialLike = {
  name: string
  category: string
  cost_price?: number | null
  sale_price?: number | null
}

// display-имя стекла → имя строки в glass_price_matrix (исторически 'Прозрачное М1')
export const GLASS_MATRIX_NAME: Record<string, string> = {
  'М1 прозрачное': 'Прозрачное М1',
}

// значение цвета в калькуляторе → имя цвета в shower_hw_colors.name
export const COLOR_DB_NAME: Record<string, string> = {
  chrome: 'ХРОМ', black: 'BLACK', bronze: 'БРОНЗА', gold: 'ЗОЛОТОЙ', white: 'БЕЛЫЙ',
}

// Дефолтный тип стекла для быстрых просчётов (совпадает с GLASS_TYPES[0] в UI).
export const DEFAULT_SHOWER_GLASS = 'М1 прозрачное'

// Продажная цена стекла за м² (уже с закалкой) из glass_price_matrix; фолбэк — materials.
export function resolveShowerGlassCostPerM2(
  glassMatrix: GlassMatrixMap,
  glassType: string,
  thickness: number,
  materials: MaterialLike[],
): number {
  const matrixKey   = GLASS_MATRIX_NAME[glassType] ?? glassType
  const matrixRow   = glassMatrix[matrixKey]
  const matrixPrice = matrixRow?.[`t${thickness}`] ?? null
  if (matrixPrice != null) return matrixPrice

  const mat  = materials.find(m => m.name === `Стекло ${glassType} ${thickness} мм` && m.category === 'стекло')
  const rawPrice = mat?.sale_price ?? mat?.cost_price ?? 0
  const temp = materials.find(m => m.name === `Закалка ${thickness} мм` && m.category === 'закалка')
  return (rawPrice ?? 0) + (temp?.cost_price ?? 0)
}

// Процент расходов (знаменатель финмодели) — из financial_settings по product_type; фолбэк 12.
export function resolveShowerExpensesPercent(
  allSettings: FinSettingRow[],
  tier: 'budget' | 'standard',
): number {
  const pt = tier === 'budget' ? 'shower_budget' : 'shower_standard'
  const s = allSettings.find(s => s.product_type === pt) ?? allSettings.find(s => s.tier === tier)
  return s?.tax_percent ?? 12
}

// Себестоимость комплекта фурнитуры (бюджет) из shower_budget_manual_prices.
// undefined → калькулятор посчитает по формуле hardware_base × коэф.тарифа × коэф.цвета.
export function resolveBudgetHardwareCost(
  budgetManualPrices: BudgetManualPrice[],
  hwColors: HwColorRow[],
  modelId: string,
  hwColor: string,
): number | undefined {
  const wanted = COLOR_DB_NAME[hwColor] ?? hwColor.toUpperCase()
  const budgetColorId = hwColors.find(c => c.name.toUpperCase() === wanted)?.id
  if (!budgetColorId) return undefined
  const price = budgetManualPrices.find(p => p.model_id === modelId && p.color_id === budgetColorId)?.price ?? 0
  return price || undefined
}
