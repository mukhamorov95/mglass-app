import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { amoGet, amoGetAll, getPipelines, getUsers, getDomain } from '@/lib/amocrm'
import type { AmoEvent, AmoNote, AmoLead } from '@/lib/amocrm'
import { mskDay, mskDayStart } from '@/lib/amoActivity'
import { AMO_CLOSED_STATUSES } from '@/lib/amoLead'

export const runtime     = 'nodejs'
export const maxDuration = 60

function stageZone(name: string): 1 | 2 | 3 | null {
  const n = name.toLowerCase()
  if (n.includes('новая заявка') || n.includes('назначен ответственный') ||
      n.includes('проработка') || n.includes('разговор состоялся') ||
      n.includes('долгострой') || n.includes('готов купить')) return 1
  if (n.includes('замер') || n.includes('согласование') ||
      n.includes('чертежи в работу') || n.startsWith('кп') ||
      n.includes('счёт выставлен') || n.includes('счет выставлен') ||
      n.includes('ждём оплату') || n.includes('ждем оплату')) return 2
  if (n.includes('оплата сделана') || n.includes('оплата получена') ||
      n.includes('счёт оплачен') || n.includes('счет оплачен') ||
      n.includes('заказ в работе') || n.includes('к монтажу') ||
      n.includes('монтаж') || n.includes('рекламация') ||
      n.includes('оплата остатка') || n.includes('оплата дизайнером')) return 3
  return null
}

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

  // Stage map
  const stageMap = new Map<number, { name: string; zone: 1 | 2 | 3 | null }>()
  for (const p of pipelines) {
    for (const s of p._embedded?.statuses ?? []) {
      stageMap.set(s.id, { name: s.name, zone: stageZone(s.name) })
    }
  }

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
  const domain = getDomain()
  const amoUser = amoUsers.find(u => u.id === amoUserId)

  return NextResponse.json({
    user: amoUser ?? { id: amoUserId, name: user.email ?? 'Менеджер', email: user.email ?? '' },
    today: { newLeads, callsMade, messagesSent, cardsMoved },
    activeLeads: activeLeads.length,
    zone1: activeLeads.filter(l => stageMap.get(l.status_id)?.zone === 1).length,
    zone2: activeLeads.filter(l => stageMap.get(l.status_id)?.zone === 2).length,
    zone3: activeLeads.filter(l => stageMap.get(l.status_id)?.zone === 3).length,
    staleZone1: staleZone1.sort(sort).slice(0, 5),
    staleZone2: staleZone2.sort(sort).slice(0, 5),
    staleZone3: staleZone3.sort(sort).slice(0, 5),
    invoiceStale: invoiceStale.sort(sort).slice(0, 5),
    domain,
  })
}
