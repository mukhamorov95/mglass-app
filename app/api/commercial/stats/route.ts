import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { collectAllMetrics } from '@/lib/salesMonitor'
import { getDomain } from '@/lib/amocrm'
import { createClient as createServiceClient } from '@supabase/supabase-js'

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
  const period = searchParams.get('period') ?? 'today' // today | week | month | year

  // Today: real-time from AmoCRM
  if (period === 'today') {
    const metrics = await collectAllMetrics()
    const domain  = getDomain()
    return NextResponse.json({ period: 'today', domain, managers: metrics.map(m => ({
      id:           m.user.id,
      name:         m.user.name,
      newLeads:     m.newLeadsToday,
      callsMade:    m.callsMade,
      messagesSent: m.messagesSent,
      cardsMoved:   m.cardsMoved,
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

  // Historical: from sales_monitor_daily
  const svc = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const now = new Date()
  let fromDate: string
  if (period === 'week') {
    const d = new Date(now); d.setDate(d.getDate() - 7)
    fromDate = d.toISOString().slice(0, 10)
  } else if (period === 'month') {
    const d = new Date(now); d.setDate(d.getDate() - 30)
    fromDate = d.toISOString().slice(0, 10)
  } else {
    const d = new Date(now); d.setDate(d.getDate() - 365)
    fromDate = d.toISOString().slice(0, 10)
  }

  const { data: rows } = await svc
    .from('sales_monitor_daily')
    .select('*')
    .gte('date', fromDate)
    .order('date', { ascending: false })

  if (!rows || rows.length === 0) {
    return NextResponse.json({ period, managers: [], noData: true })
  }

  // Aggregate by manager
  const byManager = new Map<number, {
    id: number; name: string
    newLeads: number; callsMade: number; messagesSent: number; cardsMoved: number
    days: number
  }>()

  for (const row of rows) {
    const existing = byManager.get(row.amo_user_id)
    if (existing) {
      existing.newLeads     += row.new_leads
      existing.callsMade    += row.calls_made
      existing.messagesSent += row.messages_sent
      existing.cardsMoved   += row.cards_moved
      existing.days++
    } else {
      byManager.set(row.amo_user_id, {
        id:           row.amo_user_id,
        name:         row.manager_name,
        newLeads:     row.new_leads,
        callsMade:    row.calls_made,
        messagesSent: row.messages_sent,
        cardsMoved:   row.cards_moved,
        days:         1,
      })
    }
  }

  // Latest active leads per manager (most recent snapshot)
  const latestByManager = new Map<number, typeof rows[0]>()
  for (const row of rows) {
    if (!latestByManager.has(row.amo_user_id)) latestByManager.set(row.amo_user_id, row)
  }

  const managers = [...byManager.values()].map(m => {
    const latest = latestByManager.get(m.id)
    return {
      ...m,
      activeLeads:  latest?.active_leads  ?? 0,
      zone1:        latest?.zone1         ?? 0,
      zone2:        latest?.zone2         ?? 0,
      zone3:        latest?.zone3         ?? 0,
      staleZone1:   latest?.stale_zone1   ?? 0,
      staleZone2:   latest?.stale_zone2   ?? 0,
      staleZone3:   latest?.stale_zone3   ?? 0,
      invoiceStale: latest?.invoice_stale ?? 0,
    }
  })

  return NextResponse.json({ period, domain: getDomain(), managers, fromDate })
}
