// M-Glass progressive commission tiers (действуют с 1 июля 2026).
// Прогрессивная схема: процент применяется только к сумме внутри диапазона.
// Streak-бонус начисляется за 3 месяца подряд на тире 3M+ / 4M+ / 5M+.
// Канонический источник правды — lib/earnings/calculateProgressiveCommission.ts
// (DEFAULT_MANAGER_COMMISSION_TIERS). Здесь дублируется в формате legacy
// helper'ов, чтобы старые консьюмеры (UI бейджи, цвета) продолжали работать.
export const TIERS = [
  { threshold: 0,          rate: 0.020, label: '2%',   streakBonus: 0      },
  { threshold: 2_000_000,  rate: 0.025, label: '2.5%', streakBonus: 0      },
  { threshold: 3_000_000,  rate: 0.030, label: '3%',   streakBonus: 20_000 },
  { threshold: 4_000_000,  rate: 0.040, label: '4%',   streakBonus: 40_000 },
  { threshold: 5_000_000,  rate: 0.050, label: '5%',   streakBonus: 60_000 },
]

export function cumulativeCommission(revenue: number): number {
  let commission = 0
  for (let i = 0; i < TIERS.length; i++) {
    const from = TIERS[i].threshold
    const to   = i + 1 < TIERS.length ? TIERS[i + 1].threshold : Infinity
    const bracket = Math.min(revenue, to) - from
    if (bracket <= 0) break
    commission += bracket * TIERS[i].rate
  }
  return Math.round(commission)
}

export function currentTier(revenue: number) {
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (revenue >= TIERS[i].threshold) return TIERS[i]
  }
  return TIERS[0]
}

export function nextTier(revenue: number) {
  return TIERS.find(t => t.threshold > revenue) ?? null
}

export function tierIndex(label: string) {
  return TIERS.findIndex(t => t.label === label)
}
