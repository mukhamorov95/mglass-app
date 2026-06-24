// Progressive (tiered/bracket) manager commission — pure function.
//
// Каждый диапазон выручки получает свою ставку. Процент применяется ТОЛЬКО к
// сумме внутри диапазона, не ко всей выручке. Пример:
//   revenue = 5 000 000
//   2M × 2%  = 40 000
//   1M × 2.5% = 25 000
//   1M × 3%  = 30 000
//   1M × 4%  = 40 000
//   ─────
//   Итого комиссия = 135 000 ₽
//
// Self-contained: без Supabase, без React, без app-импортов. Подходит для
// unit-тестов и переиспользования (admin/dashboards/reports).

export type CommissionTier = {
  from:        number          // inclusive
  to:          number | null   // exclusive; null = open-ended (последний диапазон)
  ratePercent: number          // %
}

export type CommissionTierResult = {
  from:         number
  to:           number | null
  ratePercent:  number
  amountInTier: number   // сколько ₽ выручки попало в этот диапазон
  commission:   number   // комиссия по этому диапазону (rounded)
}

export type ProgressiveCommissionResult = {
  revenue:         number
  totalCommission: number
  tiers:           CommissionTierResult[]
}

export function calculateProgressiveCommission(
  revenue: number,
  tiers:   CommissionTier[],
): ProgressiveCommissionResult {
  const safeRevenue = Number.isFinite(revenue) && revenue > 0 ? revenue : 0

  let totalRaw = 0
  const tierResults: CommissionTierResult[] = tiers.map(t => {
    const upper        = t.to ?? Infinity
    const amountInTier = Math.max(0, Math.min(safeRevenue, upper) - t.from)
    const commissionRaw = amountInTier * t.ratePercent / 100
    totalRaw += commissionRaw
    return {
      from:         t.from,
      to:           t.to,
      ratePercent:  t.ratePercent,
      amountInTier: Math.round(amountInTier),
      commission:   Math.round(commissionRaw),
    }
  })

  return {
    revenue:         Math.round(safeRevenue),
    totalCommission: Math.round(totalRaw),
    tiers:           tierResults,
  }
}

// ── Defaults для M-Glass (с 1 июля) ──────────────────────────────────────────
// 0–2M       → 2%
// 2M–3M      → 2.5%
// 3M–4M      → 3%
// 4M–5M      → 4%
// 5M+        → 5%
//
// Streak-бонусы привязаны к удержанию tier'а 3 месяца подряд:
//   3M+ tier → +20 000 ₽
//   4M+ tier → +40 000 ₽
//   5M+ tier → +60 000 ₽
export const DEFAULT_MANAGER_COMMISSION_TIERS: CommissionTier[] = [
  { from: 0,         to: 2_000_000, ratePercent: 2   },
  { from: 2_000_000, to: 3_000_000, ratePercent: 2.5 },
  { from: 3_000_000, to: 4_000_000, ratePercent: 3   },
  { from: 4_000_000, to: 5_000_000, ratePercent: 4   },
  { from: 5_000_000, to: null,      ratePercent: 5   },
]

export const DEFAULT_MANAGER_SALARY_RUB = 66_000

export const DEFAULT_STREAK_BONUSES: Array<{ minRevenue: number; bonus: number }> = [
  { minRevenue: 3_000_000, bonus: 20_000 },
  { minRevenue: 4_000_000, bonus: 40_000 },
  { minRevenue: 5_000_000, bonus: 60_000 },
]

// Найти текущий tier по выручке. Возвращает индекс в массиве tiers.
export function currentTierIndex(revenue: number, tiers: CommissionTier[]): number {
  for (let i = tiers.length - 1; i >= 0; i--) {
    if (revenue >= tiers[i].from) return i
  }
  return 0
}

// Сколько ₽ осталось до следующего диапазона (null если на последнем).
export function distanceToNextTier(revenue: number, tiers: CommissionTier[]):
  | { ratePercent: number; remaining: number; nextFrom: number }
  | null
{
  const next = tiers.find(t => t.from > revenue)
  if (!next) return null
  return { ratePercent: next.ratePercent, remaining: next.from - revenue, nextFrom: next.from }
}
