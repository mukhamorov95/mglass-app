import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getRole } from '@/lib/getRole'
import { redirect } from 'next/navigation'
import CfoClient from './CfoClient'

export type MonthRevenue = { month: string; revenue: number }

export type CfoSettings = {
  entity_type: string
  tax_system: string
  fixed_costs: {
    rent: number        // Аренда
    utilities: number   // Коммунальные
    payroll: number     // ФОТ (зарплата, льготы)
    payroll_tax: number // Налоги на ФОТ
    leasing: number     // Лизинг
    credit: number      // Кредиты и проценты
    marketing: number   // Маркетинг + реклама
    outsource: number   // Аутсорс бух. + ПО + банк
    other: number       // Прочее
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

// Basis: ТБ1 tab from financial spreadsheet (Nov 2025 plan)
// Glass 2.4M (VC 43.7%) + MGlass 6.3M (VC 69.1%) → weighted VC ≈ 62%, FC = 2,868,890
const DEFAULT_SETTINGS: CfoSettings = {
  entity_type: 'ip',
  tax_system: 'usn_6',
  fixed_costs: {
    rent:        475_000,   // Аренда
    utilities:    20_000,   // Коммунальные
    payroll:     800_000,   // ФОТ (зарплата)
    payroll_tax: 181_000,   // Налоги на ФОТ
    leasing:     505_200,   // Лизинг
    credit:      344_980,   // Кредиты и проценты
    marketing:   290_000,   // Маркетинг 250K + реклама 40K
    outsource:   190_000,   // Бухгалтерия 135K + ПО 20K + банк 35K
    other:        62_710,   // ТО, уборка, страхование, взносы ИП и пр.
  },
  profit_split: { owner_pct: 20, education_pct: 5, reserve_pct: 5 },
  avg_variable_pct: 62,     // Взвешенный VC без налога (ТБ1 ноябрь 2025)
  monthly_revenue_target: 8_700_000, // Плановая выручка из ТБ1
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
        fixed_costs: { ...DEFAULT_SETTINGS.fixed_costs, ...(data.fixed_costs ?? {}) },
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
