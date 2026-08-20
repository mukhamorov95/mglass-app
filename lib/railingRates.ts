// Ставки справочника лестничных ограждений (таблица railing_rates).
// Себестоимости монтажа/крепежа + правила количества. Продажная цена считается
// по финмодели (calcFinancialModel), здесь только себестоимость + правила.

import type { SupabaseClient } from '@supabase/supabase-js'

export type RailingRateKind = 'cost' | 'rule'

export type RailingRateRow = {
  key: string
  label: string
  unit: string
  kind: RailingRateKind
  value: number
  sale_override: number | null
  vendor: string | null
  source_url: string | null
  sort: number
}

export type RailingRateKey =
  | 'mount_per_m'
  | 'point_each'
  | 'post_each'
  | 'profile_per_m'
  | 'points_per_m'
  | 'posts_per_m'
  | 'profile_reserve_pct'

// Дефолты = стартовые числа владельца. Fallback, если таблица недоступна/пуста.
export const DEFAULT_RAILING_RATES: Record<RailingRateKey, number> = {
  mount_per_m: 5500,
  point_each: 960,
  post_each: 2950,
  profile_per_m: 6000,
  points_per_m: 4,
  posts_per_m: 1,
  profile_reserve_pct: 10,
}

export type RailingRatesMap = Record<string, number>

// Загружает ставки из БД → { key: value }. При ошибке/пустоте — дефолты.
export async function loadRailingRates(sb: SupabaseClient): Promise<RailingRatesMap> {
  try {
    const { data, error } = await sb.from('railing_rates').select('key,value')
    if (error || !data || data.length === 0) return { ...DEFAULT_RAILING_RATES }
    const map: RailingRatesMap = { ...DEFAULT_RAILING_RATES }
    for (const r of data as { key: string; value: number }[]) map[r.key] = Number(r.value)
    return map
  } catch {
    return { ...DEFAULT_RAILING_RATES }
  }
}

export function rate(rates: RailingRatesMap, key: RailingRateKey): number {
  const v = rates[key]
  return Number.isFinite(v) ? v : DEFAULT_RAILING_RATES[key]
}
