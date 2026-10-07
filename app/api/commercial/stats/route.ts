import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { collectAllMetrics } from '@/lib/salesMonitor'
import { getDomain } from '@/lib/amocrm'
import { mskDayKey } from '@/lib/time'
import { isSnapshotPeriod, snapshotLabel } from '@/lib/teamActivity'
import { loadTeamSnapshot } from '@/lib/teamActivityLoad'

export const runtime     = 'nodejs'
export const maxDuration = 45

export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  const role = profile?.role
  if (!['admin', 'ceo', 'commercial'].includes(role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const period = searchParams.get('period') ?? 'yesterday'

  // «Сейчас» — только состояние воронки и списки зависших сделок: их нет в снимках.
  // Звонки и сообщения здесь не отдаём — их счёт salesMonitor расходится со снимком
  // дня, а владелец должен видеть одну цифру (она — на «Команде» и в остальных периодах).
  if (period === 'today') {
    const metrics = await collectAllMetrics()
    return NextResponse.json({ period: 'today', live: true, domain: getDomain(), managers: metrics.map(m => ({
      id:           m.user.id,
      name:         m.user.name,
      newLeads:     null,
      callsMade:    null,
      messagesSent: null,
      cardsMoved:   null,
      activeLeads:  m.activeLeads,
      zone1: m.zone1, zone2: m.zone2, zone3: m.zone3,
      staleZone1:       m.staleZone1.length,
      staleZone2:       m.staleZone2.length,
      staleZone3:       m.staleZone3.length,
      invoiceStale:     m.invoiceStale.length,
      staleZone1Deals:  m.staleZone1,
      staleZone2Deals:  m.staleZone2,
      staleZone3Deals:  m.staleZone3,
      invoiceStaleDeals: m.invoiceStale,
    })) })
  }

  if (!isSnapshotPeriod(period)) return NextResponse.json({ error: `Неизвестный период: ${period}` }, { status: 400 })

  const today = mskDayKey(new Date())
  const snap = await loadTeamSnapshot(createServiceClient(), period, today)

  return NextResponse.json({
    period,
    live: false,
    domain: getDomain(),
    from: snap.from,
    to: snap.to,
    days: snap.days.length,
    label: snapshotLabel(snap.days, today),
    firstSnapshot: snap.firstSnapshot,
    stateDate: snap.stateDate,
    errors: snap.errors,
    noData: snap.days.length === 0,
    managers: snap.people.map(p => ({
      id:           p.amoUserId,
      name:         p.name,
      newLeads:     p.leads,
      callsMade:    p.act.out,
      callsOk:      p.act.ok,
      callsIn:      p.act.in,
      callsMissed:  p.act.missed,
      messagesSent: p.act.msgs,
      cardsMoved:   p.act.moved,
      workdays:     p.act.workdays,
      idle:         p.act.idle,
      days:         p.act.days,
      activeLeads:  p.state?.activeLeads  ?? 0,
      zone1:        p.state?.zone1        ?? 0,
      zone2:        p.state?.zone2        ?? 0,
      zone3:        p.state?.zone3        ?? 0,
      staleZone1:   p.state?.staleZone1   ?? 0,
      staleZone2:   p.state?.staleZone2   ?? 0,
      staleZone3:   p.state?.staleZone3   ?? 0,
      invoiceStale: p.state?.invoiceStale ?? 0,
    })),
  })
}
