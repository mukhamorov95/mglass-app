import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { amoGet, amoGetAll, getPipelines, getUsers, getDomain } from '@/lib/amocrm'
import type { AmoEvent, AmoNote, AmoLead } from '@/lib/amocrm'
import { mskDay, mskDayStart } from '@/lib/amoActivity'
import { AMO_CLOSED_STATUSES } from '@/lib/amoLead'
import { findSalesPipeline, salesStageMap, zoneBreakdown } from '@/lib/salesZones'

export const runtime     = 'nodejs'
export const maxDuration = 60

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('users')
    .select('amo_user_id, can_view_all_deals, role')
    .eq('id', user.id)
    .single()

  const amoUserId: number | null = profile?.amo_user_id ?? null

  if (!amoUserId) {
    return NextResponse.json({ error: 'amo_not_configured' }, { status: 200 })
  }

  // «Сегодня» — по Москве: сервер живёт в UTC, и день начинался в 03:00.
  const nowTs      = Math.floor(Date.now() / 1000)
  const todayStart = mskDayStart(mskDay(nowTs))
  const DAY        = 86400

  // Раньше тянулись ВСЕ сделки аккаунта и отбирались здесь — выгрузка не укладывалась в
  // 30 с, и страница висела на «Загружаю…». Теперь только свои. Фильтр по открытым этапам
  // AmoCRM отдаёт медленнее (замер 30.09: 559 сделок за 12,6 с против 999 за 8,7 с),
  // поэтому закрытые отсеиваем здесь.
  let fetched
  try {
    fetched = await Promise.all([
      getPipelines(),
      getUsers(),
      amoGetAll<AmoLead>('/leads', { 'filter[responsible_user_id]': String(amoUserId) }, 'leads'),
      amoGet<{ _embedded: { events: AmoEvent[] } }>('/events', {
        'filter[created_at][from]': String(todayStart),
        'filter[created_at][to]':   String(nowTs),
        limit: '250',
      }),
      amoGet<{ _embedded: { notes: AmoNote[] } }>('/leads/notes', {
        'filter[note_type]': '4,10,1,13',
        'filter[created_at][from]': String(todayStart),
        'filter[created_at][to]':   String(nowTs),
        limit: '250',
      }),
    ])
  } catch (e) {
    return NextResponse.json({ error: `AmoCRM не ответила: ${(e as Error).message}` }, { status: 502 })
  }
  const [pipelines, amoUsers, allLeads, eventsData, notesData] = fetched

  const todayEvents = eventsData?._embedded?.events ?? []
  const todayNotes  = notesData?._embedded?.notes ?? []

  // Зоны — только воронка «Продажи», как в lib/salesMonitor.ts. Раньше этапы брались из всех
  // воронок по id и по слову в названии: «Партнёры / Разговор состоялся» шёл в зону 1,
  // а 552 из 558 открытых сделок владельца лежат вне «Продаж» (замер 01.10.2026).
  const salesPipeline = findSalesPipeline(pipelines)
  const stageMap = salesStageMap(salesPipeline)

  const activeLeads = allLeads.filter(l =>
    l.responsible_user_id === amoUserId &&
    l.closed_at === null &&
    !AMO_CLOSED_STATUSES.has(l.status_id)
  )

  const myEvents = todayEvents.filter((e: AmoEvent) => e.created_by === amoUserId)
  const myNotes  = todayNotes.filter((n: AmoNote)  => n.created_by === amoUserId)

  const callsMade    = myNotes.filter(n => n.note_type === 4 || n.note_type === 13).length
  const messagesSent = myNotes.filter(n => n.note_type === 10 || n.note_type === 1).length
  const cardsMoved   = myEvents.filter(e => e.type === 'lead_status_changed').length
  const newLeads     = allLeads.filter(l => l.responsible_user_id === amoUserId && l.created_at >= todayStart).length

  // Stale deals
  type StaleInfo = { id: number; name: string; daysStale: number; stageName: string }
  const staleZone1: StaleInfo[] = []
  const staleZone2: StaleInfo[] = []
  const staleZone3: StaleInfo[] = []
  const invoiceStale: StaleInfo[] = []

  for (const lead of activeLeads) {
    if (lead.pipeline_id !== salesPipeline?.id) continue
    const stage = stageMap.get(lead.status_id)
    if (!stage) continue
    const daysStale = Math.floor((nowTs - lead.updated_at) / DAY)
    const { name: stageName, zone } = stage

    if (zone === 1 && daysStale >= 2) staleZone1.push({ id: lead.id, name: lead.name, daysStale, stageName })
    if (zone === 2) {
      if (daysStale >= 3) staleZone2.push({ id: lead.id, name: lead.name, daysStale, stageName })
      const isInvoice = stageName.toLowerCase().includes('счёт') || stageName.toLowerCase().includes('ждем')
      if (isInvoice && daysStale >= 5) invoiceStale.push({ id: lead.id, name: lead.name, daysStale, stageName })
    }
    if (zone === 3 && daysStale >= 3) staleZone3.push({ id: lead.id, name: lead.name, daysStale, stageName })
  }

  const sort = (a: StaleInfo, b: StaleInfo) => b.daysStale - a.daysStale
  const zones = zoneBreakdown(activeLeads, pipelines)
  const domain = getDomain()
  const amoUser = amoUsers.find(u => u.id === amoUserId)

  return NextResponse.json({
    user: amoUser ?? { id: amoUserId, name: user.email ?? 'Менеджер', email: user.email ?? '' },
    today: { newLeads, callsMade, messagesSent, cardsMoved },
    activeLeads: activeLeads.length,
    salesLeads: zones.sales,
    zone1: zones.zone1,
    zone2: zones.zone2,
    zone3: zones.zone3,
    unzonedStages: zones.unzonedStages,
    otherPipelines: zones.otherPipelines,
    staleZone1: staleZone1.sort(sort).slice(0, 5),
    staleZone2: staleZone2.sort(sort).slice(0, 5),
    staleZone3: staleZone3.sort(sort).slice(0, 5),
    invoiceStale: invoiceStale.sort(sort).slice(0, 5),
    domain,
  })
}
