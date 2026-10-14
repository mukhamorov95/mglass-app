// Клиентская часть моделей цены демо GLASMEN: типы, пределы ползунков и правило минимума
// заказа. Отдельно от priceModel.ts, чтобы тексты пресетов с цифрами калибровки (выручка
// окна) не попадали в браузерный бандл — экран импортирует только этот модуль.

export type PriceModelId = 'current' | 'aLine' | 'aGroup' | 'ladderB' | 'minC'

export const PRICE_MODEL_IDS: PriceModelId[] = ['current', 'aLine', 'aGroup', 'ladderB', 'minC']

export type LadderTier = { fromQty: number; pct: number }

export type PriceModelParams = {
  S: number                          // «наладка», ₽ с НДС до скидки: на строку (aLine) или на группу «заказ × материал» (aGroup)
  k: number                          // множитель прайса, подобранный для нейтральности выручки
  M: number                          // минимальная сумма заказа, ₽ с НДС после скидки (уровень заказа)
  ladder: LadderTier[]               // лесенка за серию одинаковых деталей: скидка pct % от fromQty шт.
  floorPerLine: boolean              // ladderB: пол позиции один раз на строку (true) или пол × шт. (false, как сейчас)
  ladderAppliesToTempering: boolean  // false — лесенка не трогает долю закалки (нужен input.temperingPart)
}

export const PARAM_LIMITS = {
  S: { min: 0, max: 20000 },
  k: { min: 0.5, max: 1.5 },
  M: { min: 0, max: 100000 },
  ladderTiers: 12,
  fromQty: { min: 1, max: 10000 },
  pct: { min: 0, max: 60 },
} as const

// Ступени по возрастанию порога; на одном пороге остаётся последняя.
export function normalizeLadder(tiers: LadderTier[]): LadderTier[] {
  const byQty = new Map<number, number>()
  for (const t of tiers) byQty.set(t.fromQty, t.pct)
  return [...byQty.entries()].sort((a, b) => a[0] - b[0]).map(([fromQty, pct]) => ({ fromQty, pct }))
}

export function ladderPct(qty: number, ladder: LadderTier[]): number {
  let pct = 0
  for (const t of normalizeLadder(ladder)) if (qty >= t.fromQty) pct = t.pct
  return pct
}

// Минимум — правило ЗАКАЗА: сравнивается сумма всех строк после скидки.
export function applyOrderMinimum(linesTotal: number, params: Pick<PriceModelParams, 'M'>): { total: number; minOrderApplied: boolean; topUp: number } {
  const M = Math.round(params.M)
  if (M > 0 && linesTotal < M) return { total: M, minOrderApplied: true, topUp: M - linesTotal }
  return { total: linesTotal, minOrderApplied: false, topUp: 0 }
}
