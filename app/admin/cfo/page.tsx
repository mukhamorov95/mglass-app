import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getRole } from '@/lib/getRole'
import { redirect } from 'next/navigation'
import CfoClient from './CfoClient'

export type MonthRevenue = { month: string; revenue: number }

export type CfoSettings = {
  entity_type: string
  tax_system: string
  fixed_costs: { rent: number; payroll: number; marketing: number; other: number }
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
  fixed_costs: { rent: 50000, payroll: 150000, marketing: 30000, other: 20000 },
  profit_split: { owner_pct: 20, education_pct: 5, reserve_pct: 5 },
  avg_variable_pct: 45,
  monthly_revenue_target: 1000000,
}

export default async function CfoPage() {
  const role = await getRole()
  if (role !== 'admin' && role !== 'ceo') redirect('/')

  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const since = new Date()
  since.setMonth(since.getMonth() - 11)
  since.setDate(1)
  since.setHours(0, 0, 0, 0)

  const [{ data: calcs }, { data: pricingData }] = await Promise.all([
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
  ])

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

  let settings: CfoSettings = DEFAULT_SETTINGS
  try {
    const { data } = await supabase
      .from('cfo_settings')
      .select('*')
      .eq('id', 1)
      .maybeSingle()
    if (data) {
      settings = {
        entity_type: data.entity_type ?? DEFAULT_SETTINGS.entity_type,
        tax_system: data.tax_system ?? DEFAULT_SETTINGS.tax_system,
        fixed_costs: data.fixed_costs ?? DEFAULT_SETTINGS.fixed_costs,
        profit_split: data.profit_split ?? DEFAULT_SETTINGS.profit_split,
        avg_variable_pct: data.avg_variable_pct ?? DEFAULT_SETTINGS.avg_variable_pct,
        monthly_revenue_target: data.monthly_revenue_target ?? DEFAULT_SETTINGS.monthly_revenue_target,
      }
    }
  } catch {
    // Table not created yet — use defaults
  }

  return (
    <CfoClient
      months={months}
      initialSettings={settings}
      pricingRows={(pricingData ?? []) as PricingRow[]}
    />
  )
}
