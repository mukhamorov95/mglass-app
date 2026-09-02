import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getRole } from '@/lib/getRole'
import { redirect } from 'next/navigation'
import CfoClient from './CfoClient'

export type MonthRevenue = { month: string; revenue: number }

export type MonthActuals = {
  b2c_mirror:   { revenue: number; cost: number }
  b2c_shower:   { revenue: number; cost: number }
  b2c_loft:     { revenue: number; cost: number }
  b2c_services: { revenue: number; cost: number }
  b2b_glass:    { revenue: number; cost: number }
  other:        { revenue: number; cost: number }
}

export type CfoSettings = {
  entity_type: string
  tax_system: string
  fixed_costs: {
    rent: number
    utilities: number
    payroll: number
    payroll_tax: number
    leasing: number
    credit: number
    marketing: number
    outsource: number
    other: number
  }
  profit_split: { owner_pct: number; education_pct: number; reserve_pct: number }
  avg_variable_pct: number
  monthly_revenue_target: number
}

export type PricingRow = {
  id: number
  product_type: string
  default_margin: number
  tax_percent: number
  min_margin: number
  max_discount_percent: number
}

const DEFAULT_SETTINGS: CfoSettings = {
  entity_type: 'ip',
  tax_system: 'usn_6',
  fixed_costs: {
    rent:        475_000,
    utilities:    20_000,
    payroll:     800_000,
    payroll_tax: 181_000,
    leasing:     505_200,
    credit:      344_980,
    marketing:   290_000,
    outsource:   190_000,
    other:        62_710,
  },
  profit_split: { owner_pct: 20, education_pct: 5, reserve_pct: 5 },
  avg_variable_pct: 62,
  monthly_revenue_target: 8_700_000,
}

const PRODUCT_TO_DIR: Record<string, keyof MonthActuals> = {
  mirror:           'b2c_mirror',
  mirror_light:     'b2c_mirror',
  shower:           'b2c_shower',
  shower_standard:  'b2c_shower',
  shower_budget:    'b2c_shower',
  loft:             'b2c_loft',
}

export default async function CfoPage() {
  const role = await getRole()
  if (role !== 'admin' && role !== 'ceo' && role !== 'cfo') redirect('/')

  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const now = new Date()
  const since = new Date(now)
  since.setMonth(since.getMonth() - 11)
  since.setDate(1)
  since.setHours(0, 0, 0, 0)

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  const [
    { data: calcs },
    { data: pricingData },
    { data: monthCalcsAll },
  ] = await Promise.all([
    supabase
      .from('calculations')
      .select('created_at, final_price')
      .eq('status', 'approved')
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: true }),
    supabase
      .from('financial_settings')
      .select('id, product_type, default_margin, tax_percent, min_margin, max_discount_percent')
      .not('product_type', 'is', null)
      .order('id'),
    supabase
      .from('calculations')
      .select('product_type, final_price, cost_breakdown, financial_breakdown')
      .gte('created_at', monthStart)
      .neq('status', 'cancelled'),
  ])

  // Build 12-month revenue history
  const monthMap: Record<string, number> = {}
  for (const c of (calcs ?? [])) {
    const d = new Date(c.created_at)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    monthMap[key] = (monthMap[key] ?? 0) + (c.final_price ?? 0)
  }
  const months: MonthRevenue[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date()
    d.setMonth(d.getMonth() - i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    months.push({ month: key, revenue: monthMap[key] ?? 0 })
  }

  // Aggregate current-month actuals by direction
  const monthActuals: MonthActuals = {
    b2c_mirror:   { revenue: 0, cost: 0 },
    b2c_shower:   { revenue: 0, cost: 0 },
    b2c_loft:     { revenue: 0, cost: 0 },
    b2c_services: { revenue: 0, cost: 0 },
    b2b_glass:    { revenue: 0, cost: 0 },
    other:        { revenue: 0, cost: 0 },
  }
  for (const c of (monthCalcsAll ?? [])) {
    const dir = PRODUCT_TO_DIR[c.product_type ?? ''] ?? 'other'
    const cost    = (c.cost_breakdown as { totalCost?: number } | null)?.totalCost ?? 0
    const svcRev  = (c.financial_breakdown as { servicesTotal?: number } | null)?.servicesTotal ?? 0
    monthActuals[dir].revenue += (c.final_price ?? 0)
    monthActuals[dir].cost    += cost
    monthActuals.b2c_services.revenue += svcRev
  }

  // Load CFO settings from DB
  let settings: CfoSettings = DEFAULT_SETTINGS
  try {
    const { data } = await supabase
      .from('cfo_settings')
      .select('*')
      .eq('id', 1)
      .maybeSingle()
    if (data) {
      settings = {
        entity_type:            data.entity_type            ?? DEFAULT_SETTINGS.entity_type,
        tax_system:             data.tax_system             ?? DEFAULT_SETTINGS.tax_system,
        fixed_costs:            { ...DEFAULT_SETTINGS.fixed_costs, ...(data.fixed_costs ?? {}) },
        profit_split:           data.profit_split           ?? DEFAULT_SETTINGS.profit_split,
        avg_variable_pct:       data.avg_variable_pct       ?? DEFAULT_SETTINGS.avg_variable_pct,
        monthly_revenue_target: data.monthly_revenue_target ?? DEFAULT_SETTINGS.monthly_revenue_target,
      }
    }
  } catch {
    // cfo_settings table may not exist yet
  }

  return (
    <CfoClient
      months={months}
      initialSettings={settings}
      pricingRows={(pricingData ?? []) as PricingRow[]}
      monthActuals={monthActuals}
      monthLabel={now.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', month: 'long', year: 'numeric' })}
    />
  )
}
