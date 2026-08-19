import { getRole } from '@/lib/getRole'
import { redirect } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase-service'
import ModelClient from './ModelClient'
import {
  REV_DIRECTIONS,
  FC_LABELS,
  FINANCING_KEYS,
  type RevenueLine,
  type FixedCostLine,
  type TaxSystem,
  type ProfitSplit,
} from '@/lib/cfo/factModel'

// Дефолты — те же, что DEFAULT_SETTINGS на /admin/cfo. Используются, пока в
// cfo_settings нет реальных значений (помечаются в UI как «дефолт»).
const DEFAULT_FIXED: Record<string, number> = {
  rent: 475_000, utilities: 20_000, payroll: 800_000, payroll_tax: 181_000,
  leasing: 505_200, credit: 344_980, marketing: 290_000, outsource: 190_000, other: 62_710,
}
const DEFAULT_PLAN: Record<string, number> = {
  b2c_mirror: 1_500_000, b2c_shower: 2_000_000, b2c_loft: 1_500_000,
  b2c_services: 1_300_000, b2b_glass: 2_400_000, other: 0,
}
const DEFAULT_PROFIT_SPLIT: ProfitSplit = { owner: 20, education: 5, reserve: 5 }
const INSURANCE_MONTHLY = 4_125

const PRODUCT_TO_DIR: Record<string, string> = {
  mirror: 'b2c_mirror', mirror_light: 'b2c_mirror',
  shower: 'b2c_shower', shower_standard: 'b2c_shower', shower_budget: 'b2c_shower',
  loft: 'b2c_loft',
}

export default async function CfoModelPage() {
  const role = await getRole()
  if (role !== 'admin' && role !== 'ceo' && role !== 'cfo') redirect('/')

  const supabase = createServiceClient()

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  const actualRev: Record<string, number> = {
    b2c_mirror: 0, b2c_shower: 0, b2c_loft: 0, b2c_services: 0, b2b_glass: 0, other: 0,
  }
  let settingsRow: {
    fixed_costs?: Record<string, number>
    tax_system?: string
    profit_split?: ProfitSplit
  } | null = null

  try {
    const [{ data: monthCalcs }, { data: cfoSettings }] = await Promise.all([
      supabase
        .from('calculations')
        .select('product_type, final_price, financial_breakdown')
        .gte('created_at', monthStart)
        .eq('status', 'approved'),
      supabase.from('cfo_settings').select('*').eq('id', 1).maybeSingle(),
    ])
    for (const c of (monthCalcs ?? [])) {
      const dir = PRODUCT_TO_DIR[c.product_type ?? ''] ?? 'other'
      actualRev[dir] += (c.final_price ?? 0)
      const svc = (c.financial_breakdown as { servicesTotal?: number } | null)?.servicesTotal ?? 0
      actualRev.b2c_services += svc
    }
    settingsRow = cfoSettings
  } catch {
    // calculations / cfo_settings могут отсутствовать — падаем на дефолты
  }

  const fixedCostsMap: Record<string, number> = { ...DEFAULT_FIXED, ...(settingsRow?.fixed_costs ?? {}) }
  const taxSystem: TaxSystem = (settingsRow?.tax_system as TaxSystem) ?? 'usn_6'
  const profitSplit: ProfitSplit = settingsRow?.profit_split ?? DEFAULT_PROFIT_SPLIT

  const revenueLines: RevenueLine[] = REV_DIRECTIONS.map((d) => {
    const actual = actualRev[d.id] ?? 0
    const hasActual = actual > 0
    return {
      id: d.id,
      label: d.label,
      vcPct: d.vcPct,
      revenue: hasActual ? Math.round(actual) : (DEFAULT_PLAN[d.id] ?? 0),
      isActual: hasActual,
    }
  })

  const fixedCosts: FixedCostLine[] = Object.keys(FC_LABELS).map((key) => ({
    key,
    label: FC_LABELS[key],
    amount: fixedCostsMap[key] ?? 0,
    isFinancing: FINANCING_KEYS.includes(key),
  }))

  return (
    <ModelClient
      revenueLines={revenueLines}
      fixedCosts={fixedCosts}
      taxSystem={taxSystem}
      profitSplit={profitSplit}
      insuranceMonthly={INSURANCE_MONTHLY}
      monthLabel={now.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}
    />
  )
}
