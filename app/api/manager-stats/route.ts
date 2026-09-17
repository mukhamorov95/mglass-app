import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { getSessionUser } from '@/lib/getRole'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { resolvePeriod, parseManagers } from '@/lib/sales/period'
import { mskDayKey } from '@/lib/time'
import { METRIC_KEYS, foldStats, type StatFact } from '@/lib/sales/managerStats'

export const dynamic = 'force-dynamic'

// Показатели менеджеров за период: разговоры → замеры назначены → проведены →
// оплаты → деньги. Источник — manager_stats_daily (догон управленческой книги
// владельца, scripts/import-manager-stats.mjs).

export async function GET(req: NextRequest) {
  const guard = await requireRole(['admin', 'ceo', 'manager', 'commercial', 'cfo'])
  if (guard instanceof NextResponse) return guard

  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'no user' }, { status: 401 })
  const sbUser = await createClient()
  const { data: profile } = await sbUser.from('users')
    .select('name, role, can_view_all_deals').eq('id', user.id).maybeSingle()
  const me = (profile?.name as string) ?? user.email ?? ''
  const canAll = ['admin', 'ceo', 'commercial', 'cfo'].includes((profile?.role as string) ?? '')
    || profile?.can_view_all_deals === true

  const sp = new URL(req.url).searchParams
  const period = resolvePeriod(
    { month: sp.get('month'), from: sp.get('from'), to: sp.get('to'), mode: sp.get('mode') },
    mskDayKey(),
  )
  const picked = parseManagers(sp.get('managers'))

  const sb = createServiceClient()
  let q = sb.from('manager_stats_daily')
    .select('stat_date, manager, metric, value')
    .gte('stat_date', period.from).lte('stat_date', period.to)
    .limit(20000)
  // Менеджер видит свои показатели: чужая выработка — не его данные.
  if (!canAll) q = q.eq('manager', me)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const facts = (data ?? []) as StatFact[]
  const { rows, totals, days } = foldStats(facts, picked)

  // Когда последний раз обновляли из книги — без этого непонятно, свежие ли цифры.
  const { data: fresh } = await sb.from('manager_stats_daily')
    .select('updated_at, stat_date').order('updated_at', { ascending: false }).limit(1)
  const { data: last } = await sb.from('manager_stats_daily')
    .select('stat_date').order('stat_date', { ascending: false }).limit(1)

  return NextResponse.json({
    rows, totals,
    metrics: METRIC_KEYS,
    selected: picked,
    period: { mode: period.mode, from: period.from, to: period.to, label: period.label },
    month: period.month,
    daysWithData: days,
    updatedAt: fresh?.[0]?.updated_at ?? null,
    lastDay: last?.[0]?.stat_date ?? null,
    me, canAll,
  })
}
