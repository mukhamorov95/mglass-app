export const TIERS = [
  { threshold: 0,          rate: 0.02, label: '2%', streakBonus: 0        },
  { threshold: 2_000_000,  rate: 0.03, label: '3%', streakBonus: 20_000   },
  { threshold: 3_000_000,  rate: 0.04, label: '4%', streakBonus: 40_000   },
  { threshold: 4_000_000,  rate: 0.05, label: '5%', streakBonus: 60_000   },
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
