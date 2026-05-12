'use client'

import { useState, useEffect } from 'react'

export type OwnerStrategy = {
  target_margin:          number  // целевая маржа %
  min_margin:             number  // минимально допустимая маржа %
  monthly_revenue_target: number  // план выручки в месяц ₽
  max_manager_discount:   number  // максимальная скидка менеджера без согласования %
  warranty_days:          number  // гарантия в днях
  scrap_rate:             number  // процент брака %
  lead_time_standard:     number  // срок стандарт (дней)
  lead_time_express:      number  // срок срочно (дней)
  b2b_min_order:          number  // минимальный B2B заказ ₽
  new_clients_monthly:    number  // план новых клиентов в месяц
  price_positioning:      string  // same | above | below
  installation_mode:      string  // own | subcontract | none
  peak_months:            number[] // сезонные месяцы (1-12)
  top_product_priority:   string  // shower | mirror | loft
  growth_priority:        string  // свободный текст
}

const DEFAULTS: OwnerStrategy = {
  target_margin:          40,
  min_margin:             25,
  monthly_revenue_target: 3_000_000,
  max_manager_discount:   10,
  warranty_days:          365,
  scrap_rate:             5,
  lead_time_standard:     7,
  lead_time_express:      3,
  b2b_min_order:          50_000,
  new_clients_monthly:    20,
  price_positioning:      'same',
  installation_mode:      'own',
  peak_months:            [4, 5, 9, 10, 11],
  top_product_priority:   'shower',
  growth_priority:        '',
}

function parse(raw: Record<string, string>): OwnerStrategy {
  const n = (key: keyof OwnerStrategy): number => Number(raw[key as string]) || (DEFAULTS[key] as number)
  return {
    target_margin:          n('target_margin'),
    min_margin:             n('min_margin'),
    monthly_revenue_target: n('monthly_revenue_target'),
    max_manager_discount:   n('max_manager_discount'),
    warranty_days:          n('warranty_days'),
    scrap_rate:             n('scrap_rate'),
    lead_time_standard:     n('lead_time_standard'),
    lead_time_express:      n('lead_time_express'),
    b2b_min_order:          n('b2b_min_order'),
    new_clients_monthly:    n('new_clients_monthly'),
    price_positioning:      raw.price_positioning   || DEFAULTS.price_positioning,
    installation_mode:      raw.installation_mode   || DEFAULTS.installation_mode,
    peak_months:            (raw.peak_months || '4,5,9,10,11').split(',').map(Number).filter(Boolean),
    top_product_priority:   raw.top_product_priority || DEFAULTS.top_product_priority,
    growth_priority:        raw.growth_priority      || '',
  }
}

let _cache: OwnerStrategy | null = null
let _fetchPromise: Promise<OwnerStrategy> | null = null

async function fetchStrategy(): Promise<OwnerStrategy> {
  if (_cache) return _cache
  if (_fetchPromise) return _fetchPromise
  _fetchPromise = fetch('/api/admin/owner-strategy')
    .then(r => r.ok ? r.json() : {})
    .then((raw: Record<string, string>) => {
      _cache = parse(raw)
      _fetchPromise = null
      return _cache
    })
    .catch(() => {
      _fetchPromise = null
      return DEFAULTS
    })
  return _fetchPromise
}

export function useOwnerStrategy() {
  const [strategy, setStrategy] = useState<OwnerStrategy>(DEFAULTS)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    fetchStrategy().then(s => { setStrategy(s); setLoaded(true) })
  }, [])

  return { strategy, loaded }
}

export { DEFAULTS as STRATEGY_DEFAULTS }
