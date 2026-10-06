import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { bookNames } from '@/lib/sales/bookNames'
import { resolvePeriod } from '@/lib/sales/period'
import { mskDayKey } from '@/lib/time'
import { DAY_METRICS, dayLedger, splitPeriod, type StatFact } from '@/lib/sales/managerStats'
import { statsViewer } from '@/lib/sales/managerStatsViewer'

export const dynamic = 'force-dynamic'

// Раскрытие строки «Показателей менеджеров»: оплаты и деньги менеджера по дням
// периода. Права те же, что у таблицы: без «видеть всех» — только свои дни.
export async function GET(req: NextRequest) {
  const viewer = await statsViewer()
  if (viewer instanceof NextResponse) return viewer

  const sp = new URL(req.url).searchParams
  const manager = (sp.get('manager') ?? '').trim()
  if (!manager) return NextResponse.json({ error: 'нужен manager' }, { status: 400 })
  if (!viewer.canAll && !bookNames(viewer.me).includes(manager)) {
    return NextResponse.json({ error: 'Можно смотреть только свои дни' }, { status: 403 })
  }

  const period = resolvePeriod(
    { month: sp.get('month'), from: sp.get('from'), to: sp.get('to'), mode: sp.get('mode') },
    mskDayKey(),
  )
  const { months } = splitPeriod(period.from, period.to)
  const sb = createServiceClient()
  const [daysRes, monthsRes] = await Promise.all([
    sb.from('manager_stats_daily').select('stat_date, manager, metric, value')
      .eq('manager', manager).in('metric', [...DAY_METRICS]).neq('value', 0)
      .gte('stat_date', period.from).lte('stat_date', period.to).order('stat_date').limit(20000),
    months.length
      ? sb.from('manager_stats_monthly').select('month, metric, value')
        .eq('manager', manager).in('month', months).in('metric', [...DAY_METRICS]).limit(5000)
      : Promise.resolve({ data: [] as { month: string; metric: string; value: number }[], error: null }),
  ])
  const error = daysRes.error ?? monthsRes.error
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    manager,
    period: { from: period.from, to: period.to, label: period.label },
    lines: dayLedger((daysRes.data ?? []) as StatFact[], monthsRes.data ?? [], months),
  })
}
