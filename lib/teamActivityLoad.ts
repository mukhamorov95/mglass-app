import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { addDays, isWorkday, pickDay, type DayRow, type Schedule } from '@/lib/morning'
import { sellersActivity, snapshotRange, type Seller, type SellerActivity, type SnapshotPeriod } from '@/lib/teamActivity'

// Снимки дня продавцов за период + состояние воронки из последнего снимка
// sales_monitor_daily (крон 18:00). Ни одного запроса в amo. Service-ключ —
// роль проверяет вызывающий маршрут.

export type FunnelState = {
  activeLeads: number; zone1: number; zone2: number; zone3: number
  staleZone1: number; staleZone2: number; staleZone3: number; invoiceStale: number
}

export type TeamSnapshot = {
  from: string
  to: string
  days: string[]
  firstSnapshot: string | null
  people: (SellerActivity & { state: FunnelState | null })[]
  stateDate: string | null
  errors: string[]
}

type StateRow = {
  amo_user_id: number; date: string; active_leads: number; zone1: number; zone2: number; zone3: number
  stale_zone1: number; stale_zone2: number; stale_zone3: number; invoice_stale: number
}

export async function loadTeamSnapshot(sb: SupabaseClient, period: SnapshotPeriod, today: string): Promise<TeamSnapshot> {
  const errors: string[] = []
  const note = (what: string, e: { message: string } | null) => { if (e) errors.push(`${what}: ${e.message}`) }

  const [sch, first, lastState] = await Promise.all([
    sb.from('manager_schedules').select('amo_user_id, name, work_from, work_to, work_days, starts_on, is_seller').eq('is_seller', true),
    sb.from('manager_day_stats').select('day').order('day', { ascending: true }).limit(1).maybeSingle(),
    sb.from('sales_monitor_daily').select('date').order('date', { ascending: false }).limit(1).maybeSingle(),
  ])
  note('график', sch.error); note('снимки дня', first.error); note('воронка', lastState.error)
  const sellers: Seller[] = ((sch.data ?? []) as Schedule[]).map(s => ({ amoUserId: Number(s.amo_user_id), name: s.name, schedule: s }))
  const ids = sellers.map(s => s.amoUserId)

  let { from, to } = snapshotRange(period, today)
  if (period === 'yesterday') {
    // Как «Команда»: последний день, когда команда работала по графику (в понедельник — пятница).
    const recent = await sb.from('manager_day_stats').select('day, amo_user_id, actions')
      .gte('day', addDays(today, -14)).lt('day', today).limit(1000)
    note('снимок дня', recent.error)
    const byDay = new Map<string, number>()
    for (const r of recent.data ?? []) if (ids.includes(Number(r.amo_user_id))) byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.actions)
    const workday = (d: string) => sellers.some(s => isWorkday(d, s.schedule))
    const day = pickDay([...byDay].map(([d, actions]) => ({ day: d, actions })), today, workday)
    if (day) from = to = day
  }

  const rows: DayRow[] = []
  for (let i = 0; ; i += 1000) {
    const page = await sb.from('manager_day_stats').select('*').gte('day', from).lte('day', to)
      .order('day').order('amo_user_id').range(i, i + 999)
    if (page.error) { note('снимки дня', page.error); break }
    rows.push(...((page.data ?? []) as DayRow[]))
    if (!page.data || page.data.length < 1000) break
  }
  const days = [...new Set(rows.map(r => r.day))].sort()

  const state = new Map<number, FunnelState>()
  const stateDate = (lastState.data?.date as string | undefined) ?? null
  if (stateDate) {
    const st = await sb.from('sales_monitor_daily')
      .select('amo_user_id, date, active_leads, zone1, zone2, zone3, stale_zone1, stale_zone2, stale_zone3, invoice_stale')
      .eq('date', stateDate)
    note('воронка', st.error)
    for (const r of (st.data ?? []) as StateRow[]) {
      state.set(Number(r.amo_user_id), {
        activeLeads: r.active_leads, zone1: r.zone1, zone2: r.zone2, zone3: r.zone3,
        staleZone1: r.stale_zone1, staleZone2: r.stale_zone2, staleZone3: r.stale_zone3, invoiceStale: r.invoice_stale,
      })
    }
  }

  return {
    from, to, days,
    firstSnapshot: (first.data?.day as string | undefined) ?? null,
    people: sellersActivity(rows, sellers, days).map(p => ({ ...p, state: state.get(p.amoUserId) ?? null })),
    stateDate,
    errors,
  }
}
