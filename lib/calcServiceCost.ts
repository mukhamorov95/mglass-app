export type ProductionSettings = {
  worker_monthly_salary: number
  working_days_per_month: number
  working_hours_per_day: number
  overhead_percent: number
  default_margin_percent: number
}

export type SizeTier = {
  label: string
  max_mm: number | null
  time_minutes: number
  consumables_cost_rub: number
}

export type ServiceForCalc = {
  time_minutes: number
  equipment_depr_rub: number
  consumables_cost_rub: number
  overhead_override_pct?: number | null
  margin_override_pct?: number | null
  sale_price_override?: number | null
  size_tiers?: SizeTier[]
}

export type ServiceCostResult = {
  labor_cost: number
  equipment_cost: number
  consumables_cost: number
  overhead_cost: number
  cost_price: number
  sale_price: number
  minute_rate: number
}

export function calcServiceCost(
  service: ServiceForCalc,
  settings: ProductionSettings,
  tierIndex?: number,
): ServiceCostResult {
  const minuteRate = settings.worker_monthly_salary /
    (settings.working_days_per_month * settings.working_hours_per_day * 60)

  const tiers = service.size_tiers ?? []
  let timeMinutes = service.time_minutes
  let consumablesCost = service.consumables_cost_rub

  if (tiers.length > 0 && tierIndex !== undefined) {
    const tier = tiers[Math.min(tierIndex, tiers.length - 1)]
    if (tier) {
      timeMinutes = tier.time_minutes
      consumablesCost = tier.consumables_cost_rub
    }
  }

  const laborCost = minuteRate * timeMinutes
  const equipmentCost = service.equipment_depr_rub
  const directCost = laborCost + equipmentCost + consumablesCost

  const overheadPct = service.overhead_override_pct ?? settings.overhead_percent
  const overheadCost = directCost * (overheadPct / 100)
  const costPrice = directCost + overheadCost

  let salePrice: number
  if (service.sale_price_override != null && service.sale_price_override > 0) {
    salePrice = service.sale_price_override
  } else {
    const markupPct = service.margin_override_pct ?? settings.default_margin_percent
    salePrice = costPrice * (1 + markupPct / 100)
  }

  const safe = (n: number, fallback = 0) => (isFinite(n) && !isNaN(n) ? n : fallback)

  return {
    labor_cost:       safe(Math.round(laborCost * 100) / 100),
    equipment_cost:   safe(Math.round(equipmentCost * 100) / 100),
    consumables_cost: safe(Math.round(consumablesCost * 100) / 100),
    overhead_cost:    safe(Math.round(overheadCost * 100) / 100),
    cost_price:       safe(Math.round(costPrice)),
    sale_price:       safe(Math.round(salePrice)),
    minute_rate:      safe(Math.round(minuteRate * 100) / 100),
  }
}

export const DEFAULT_PRODUCTION_SETTINGS: ProductionSettings = {
  worker_monthly_salary: 60000,
  working_days_per_month: 21,
  working_hours_per_day: 8,
  overhead_percent: 20,
  default_margin_percent: 40,
}
