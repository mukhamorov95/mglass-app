import { NextResponse } from 'next/server'
import { requireOwner } from '@/lib/apiAuth'
import { getPipelines, getLeads, getUsers, amoGet } from '@/lib/amocrm'
import type { AmoNote } from '@/lib/amocrm'

export const runtime     = 'nodejs'
export const maxDuration = 30

export async function GET() {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard

  const now        = new Date()
  const todayStart = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000)
  const nowTs      = Math.floor(now.getTime() / 1000)

  const [pipelines, allLeads, notesData, users, eventsData] = await Promise.all([
    getPipelines(),
    getLeads({}),
    amoGet<{ _embedded: { notes: AmoNote[] } }>('/leads/notes', {
      'filter[created_at][from]': String(todayStart),
      'filter[created_at][to]':   String(nowTs),
      limit: '250',
    }),
    getUsers(),
    amoGet<{ _embedded: { events: Array<{ id: string; type: string; created_by: number }> } }>('/events', {
      'filter[created_at][from]': String(todayStart),
      'filter[created_at][to]':   String(nowTs),
      limit: '250',
    }),
  ])

  const todayNotes  = notesData?._embedded?.notes ?? []
  const todayEvents = eventsData?._embedded?.events ?? []

  // Event type distribution
  const eventTypes: Record<string, number> = {}
  for (const e of todayEvents) {
    eventTypes[e.type] = (eventTypes[e.type] ?? 0) + 1
  }

  const managerIds = (process.env.AMOCRM_MANAGERS_IDS ?? '').split(',').map(s => Number(s.trim()))
  const userMap    = new Map(users.map(u => [u.id, u]))

  // Find sales pipeline
  const salesPipeline = pipelines.find(p =>
    p.name.toLowerCase().includes('продаж') ||
    String(p.id) === (process.env.AMOCRM_SALES_PIPELINE_ID ?? '')
  ) ?? pipelines[0]

  const salesLeads  = salesPipeline ? allLeads.filter(l => l.pipeline_id === salesPipeline.id) : allLeads
  const activeLeads = salesLeads.filter(l => l.closed_at === null && l.status_id !== 142 && l.status_id !== 143)

  // Note types seen today
  const noteTypes: Record<string, number> = {}
  for (const n of todayNotes) {
    noteTypes[String(n.note_type)] = (noteTypes[String(n.note_type)] ?? 0) + 1
  }

  // call_out/call_in with vs without duration (SIPUNI vs Wazzup)
  const callOutNotes = todayNotes.filter(n => n.note_type === 'call_out' || n.note_type === 'call_in')
  const withDuration    = callOutNotes.filter(n => (n.params?.duration ?? 0) > 0).length
  const withoutDuration = callOutNotes.filter(n => !(n.params?.duration)).length

  // Per-manager stats using new logic (calls = duration > 0, messages = no duration + email)
  const managerStats = managerIds.map(uid => {
    const user    = userMap.get(uid)
    const myLeads = activeLeads.filter(l => l.responsible_user_id === uid)
    const myNotes = todayNotes.filter(n => n.created_by === uid)

    const calls = myNotes.filter(n =>
      (n.note_type === 'call_out' || n.note_type === 'call_in') &&
      (n.params?.duration ?? 0) > 0
    ).length

    const messages = myNotes.filter(n =>
      n.note_type === 'amomail_message' ||
      ((n.note_type === 'call_out' || n.note_type === 'call_in') && !(n.params?.duration))
    ).length

    const cardsMoved = todayEvents.filter(e => e.created_by === uid && e.type === 'lead_status_changed').length

    return {
      id:          uid,
      name:        user?.name ?? `Unknown #${uid}`,
      activeLeads: myLeads.length,
      callsToday:  calls,
      msgsToday:   messages,
      cardsMoved,
      notesCreatedByManager: myNotes.length,
    }
  })

  // Sample call notes to inspect params
  const sampleCallNotes = callOutNotes.slice(0, 10).map(n => ({
    id: n.id, note_type: n.note_type, created_by: n.created_by,
    duration: n.params?.duration, hasDuration: (n.params?.duration ?? 0) > 0,
    created_at: n.created_at,
  }))

  return NextResponse.json({
    pipelines: pipelines.map(p => ({
      id: p.id, name: p.name, stagesCount: p._embedded?.statuses?.length ?? 0,
    })),
    salesPipeline: salesPipeline ? { id: salesPipeline.id, name: salesPipeline.name } : null,
    totalAllLeads:    allLeads.length,
    totalSalesLeads:  salesLeads.length,
    totalActiveLeads: activeLeads.length,
    todayStart,
    nowTs,
    todayNotesCount:   todayNotes.length,
    noteTypesToday:    noteTypes,
    callNotes: { total: callOutNotes.length, withDuration, withoutDuration },
    sampleCallNotes,
    eventTypesToday: eventTypes,
    totalEvents: todayEvents.length,
    managerStats,
    envPipelineId: process.env.AMOCRM_SALES_PIPELINE_ID ?? '(не задан)',
  })
}
