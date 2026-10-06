import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { statsViewer } from '@/lib/sales/managerStatsViewer'
import { bookNames } from '@/lib/sales/bookNames'
import { resolvePeriod, parseManagers } from '@/lib/sales/period'
import { mskDayKey } from '@/lib/time'
import { METRIC_KEYS, foldStats, splitPeriod, describeNote, type StatFact, type MonthNote } from '@/lib/sales/managerStats'

export const dynamic = 'force-dynamic'

// Показатели менеджеров за период: разговоры → замеры назначены → проведены →
// оплаты → деньги. Источник — управленческая книга владельца: целые месяцы из
// manager_stats_monthly (итог месяца), края периода из manager_stats_daily
// (дни). Догоняется scripts/import-manager-stats.mjs.

export async function GET(req: NextRequest) {
  const viewer = await statsViewer()
  if (viewer instanceof NextResponse) return viewer
  const { me, canAll } = viewer

  const sp = new URL(req.url).searchParams
  const period = resolvePeriod(
    { month: sp.get('month'), from: sp.get('from'), to: sp.get('to'), mode: sp.get('mode') },
    mskDayKey(),
  )
  const picked = parseManagers(sp.get('managers'))

  const sb = createServiceClient()
  // Целые месяцы — из итога месяца книги (то, что владелец видит в колонке
  // месяца), края периода — по дням. Сложить дни вместо итога значит потерять
  // суммы, внесённые в книгу только итогом месяца.
  const { months, dayRanges } = splitPeriod(period.from, period.to)
  const facts: StatFact[] = []
  const notes: MonthNote[] = []

  if (months.length) {
    let mq = sb.from('manager_stats_monthly')
      .select('month, manager, metric, book, days, value, kind, note_day')
      .in('month', months).limit(5000)
    if (!canAll) mq = mq.in('manager', bookNames(me))
    const { data: mrows, error: merr } = await mq
    if (merr) return NextResponse.json({ error: merr.message }, { status: 500 })
    type MonthRow = Omit<MonthNote, 'kind'> & { kind: MonthNote['kind'] | 'match' }
    for (const r of (mrows ?? []) as MonthRow[]) {
      facts.push({ stat_date: `${r.month}-01`, manager: r.manager, metric: r.metric, value: r.value })
      if (r.kind === 'match' || (r.kind === 'no_total' && !Number(r.days))) continue
      notes.push({ ...r, kind: r.kind })
    }
  }
  for (const [lo, hi] of dayRanges) {
    let dq = sb.from('manager_stats_daily')
      .select('stat_date, manager, metric, value')
      .gte('stat_date', lo).lte('stat_date', hi).limit(20000)
    if (!canAll) dq = dq.in('manager', bookNames(me))
    const { data: drows, error: derr } = await dq
    if (derr) return NextResponse.json({ error: derr.message }, { status: 500 })
    facts.push(...((drows ?? []) as StatFact[]))
  }

  const { rows, totals } = foldStats(facts, picked)

  // Когда последний раз обновляли из книги — без этого непонятно, свежие ли цифры.
  const { data: fresh } = await sb.from('manager_stats_daily')
    .select('updated_at, stat_date').order('updated_at', { ascending: false }).limit(1)
  const { data: last } = await sb.from('manager_stats_daily')
    .select('stat_date').order('stat_date', { ascending: false }).limit(1)

  return NextResponse.json({
    rows, totals,
    metrics: METRIC_KEYS,
    // Где книга сама с собой не сходится: что в ней и что показано.
    bookNotes: notes
      .filter(n => !picked.length || picked.includes(n.manager))
      .map(n => ({ ...n, text: describeNote(n) })),
    partialDays: dayRanges,
    selected: picked,
    period: { mode: period.mode, from: period.from, to: period.to, label: period.label },
    month: period.month,
    wholeMonths: months,
    updatedAt: fresh?.[0]?.updated_at ?? null,
    lastDay: last?.[0]?.stat_date ?? null,
    me, canAll,
  })
}
