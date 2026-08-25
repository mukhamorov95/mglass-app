import { getRole } from '@/lib/getRole'
import { redirect } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase-service'
import ModelClient from './ModelClient'
import { isDebtRow, type IncomeLine, type FixedLine } from '@/lib/cfo/factModel'
import { collectSourceDiagnostics, factForUnit, type SourceDiag } from '@/lib/cfo/sourceDiagnostics'

// Источник правды — «Точка безубыточности» (finplan_models): юниты 'mglass' и
// 'production'. Каждая строка: { unit, data: { incomes[], fixed[], funds } }.

type BeVar = { name: string; pct: number }
type BeIncome = { name: string; plan: number; vars: BeVar[] }
type BeFixed = { name: string; amount: number }
type BeFunds = { invest?: number; training?: number; reserve?: number; prodBonus?: number }
type BeData = { incomes?: BeIncome[]; fixed?: BeFixed[]; funds?: BeFunds }

const UNITS: { key: string; label: string }[] = [
  { key: 'mglass', label: 'M-Glass' },
  { key: 'production', label: 'Производство' },
]

const sumVars = (vars: BeVar[] = []) => vars.reduce((s, v) => s + (v.pct || 0), 0)
const fundsPctOf = (f: BeFunds = {}) =>
  ((f.invest || 0) + (f.training || 0) + (f.reserve || 0) + (f.prodBonus || 0)) / 100

export default async function CfoModelPage() {
  const role = await getRole()
  if (role !== 'admin' && role !== 'ceo' && role !== 'cfo') redirect('/')

  const supabase = createServiceClient()

  const byUnit: Record<string, BeData> = {}
  let updatedAt: string | null = null
  try {
    const { data } = await supabase.from('finplan_models').select('unit, data, updated_at')
    for (const row of (data ?? [])) {
      if (row.unit === 'mglass' || row.unit === 'production') {
        byUnit[row.unit] = (row.data ?? {}) as BeData
        if (!updatedAt || (row.updated_at && row.updated_at > updatedAt)) updatedAt = row.updated_at
      }
    }
  } catch {
    // finplan_models может отсутствовать — отдадим пустую модель
  }

  const incomes: IncomeLine[] = []
  const fixed: FixedLine[] = []
  const fundsRubByUnit: Record<string, number> = {}

  for (const u of UNITS) {
    const d = byUnit[u.key]
    if (!d) continue
    let unitMargin = 0
    ;(d.incomes ?? []).forEach((inc, i) => {
      const vcPct = sumVars(inc.vars)
      incomes.push({ id: `${u.key}_${i}`, label: inc.name, unit: u.label, plan: inc.plan || 0, vcPct })
      unitMargin += (inc.plan || 0) * (1 - vcPct / 100)
    })
    ;(d.fixed ?? []).forEach((f, i) => {
      fixed.push({ key: `${u.key}_f${i}`, label: f.name, unit: u.label, amount: f.amount || 0, isDebt: isDebtRow(f.name) })
    })
    fundsRubByUnit[u.label] = Math.round(unitMargin * fundsPctOf(d.funds))
  }

  const hasData = incomes.length > 0

  // Реальный факт с начала месяца — через диагностику источников.
  // Факт показываем ТОЛЬКО из доверенного источника (verdict='trust'); иначе
  // «данных нет» (без молчаливого нуля). Производство = запущенные заказы B2B
  // (100% предоплата → запуск = оплата). Розница пока без доверенного источника.
  const now = new Date()
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const daysElapsed = now.getDate()
  const monthLabel = now.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })

  let diagnostics: SourceDiag[] = []
  try {
    diagnostics = await collectSourceDiagnostics(supabase, monthStart)
  } catch {
    // источники могут быть недоступны — экран покажет пустую диагностику
  }

  const factByUnit: Record<string, { revenue: number; captured: boolean }> = {}
  for (const u of UNITS) {
    const f = factForUnit(diagnostics, u.label)
    factByUnit[u.label] = { revenue: f.revenue ?? 0, captured: f.captured }
  }

  return (
    <ModelClient
      incomes={incomes}
      fixed={fixed}
      fundsRubByUnit={fundsRubByUnit}
      factByUnit={factByUnit}
      diagnostics={diagnostics}
      daysElapsed={daysElapsed}
      monthLabel={monthLabel}
      hasData={hasData}
      updatedAt={updatedAt}
    />
  )
}
