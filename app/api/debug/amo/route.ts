import { NextResponse } from 'next/server'
import { getRole } from '@/lib/getRole'
import { getPipelines, getLeads, getUsers, amoGet } from '@/lib/amocrm'
import type { AmoNote } from '@/lib/amocrm'

export const runtime     = 'nodejs'
export const maxDuration = 30

export async function GET() {
  const role = await getRole()
  if (role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const now        = new Date()
  const todayStart = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000)
  const nowTs      = Math.floor(now.getTime() / 1000)

  const [pipelines, allLeads, notesData, users] = await Promise.all([
    getPipelines(),
    getLeads({}),
    amoGet<{ _embedded: { notes: AmoNote[] } }>('/leads/notes', {
      'filter[created_at][from]': String(todayStart),
      'filter[created_at][to]':   String(nowTs),
      limit: '50',
    }),
    getUsers(),
  ])

  const allNotes   = notesData?._embedded?.notes ?? []
  const todayNotes = allNotes.filter(n => !n.created_at || n.created_at >= todayStart)
  const managerIds = (process.env.AMOCRM_MANAGERS_IDS ?? '').split(',').map(s => Number(s.trim()))
  const userMap    = new Map(users.map(u => [u.id, u]))
  const leadMap    = new Map(allLeads.map(l => [l.id, l]))

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
    const t = String(n.note_type)
    noteTypes[t] = (noteTypes[t] ?? 0) + 1
  }

  // Per-manager stats (after pipeline filter)
  const managerStats = managerIds.map(uid => {
    const user       = userMap.get(uid)
    const myLeads      = activeLeads.filter(l => l.responsible_user_id === uid)
    const myCallNotes  = todayNotes.filter(n => n.created_by === uid)
    const myMsgNotes   = todayNotes.filter(n =>
      leadMap.get(n.entity_id)?.pipeline_id === salesPipeline?.id &&
      leadMap.get(n.entity_id)?.responsible_user_id === uid
    )
    const calls      = myCallNotes.filter(n => n.note_type === 'call_out' || n.note_type === 'call_in').length
    const messages   = myMsgNotes.filter(n => n.note_type === 'amomail_message').length
    return {
      id:           uid,
      name:         user?.name ?? `Unknown #${uid}`,
      activeLeads:  myLeads.length,
      callsToday:   calls,
      msgsToday:    messages,
      allPipelinesActive: allLeads.filter(l => l.responsible_user_id === uid && l.closed_at === null && l.status_id !== 142 && l.status_id !== 143).length,
    }
  })

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
    allNotesCount:   allNotes.length,
    todayNotesCount: todayNotes.length,
    noteTypesToday:  noteTypes,
    sampleNotes: allNotes.slice(0, 5).map(n => ({
      id: n.id, entity_id: n.entity_id, note_type: n.note_type,
      created_by: n.created_by, created_at: (n as AmoNote & { created_at?: number }).created_at,
      isToday: (n.created_at ?? 0) >= todayStart,
    })),
    managerStats,
    envPipelineId: process.env.AMOCRM_SALES_PIPELINE_ID ?? '(не задан)',
  })
}
