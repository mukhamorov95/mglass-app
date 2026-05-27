import { NextResponse } from 'next/server'
import { getRole } from '@/lib/getRole'
import { getPipelines, getLeads, amoGet } from '@/lib/amocrm'
import type { AmoNote } from '@/lib/amocrm'

export const runtime     = 'nodejs'
export const maxDuration = 30

export async function GET() {
  const role = await getRole()
  if (role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const now        = new Date()
  const todayStart = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000)
  const nowTs      = Math.floor(now.getTime() / 1000)

  const [pipelines, allLeads, notesData] = await Promise.all([
    getPipelines(),
    getLeads({}),
    amoGet<{ _embedded: { notes: AmoNote[] } }>('/leads/notes', {
      'filter[created_at][from]': String(todayStart),
      'filter[created_at][to]':   String(nowTs),
      limit: '50',
    }),
  ])

  const todayNotes = notesData?._embedded?.notes ?? []

  // Count leads by pipeline
  const leadsByPipeline: Record<string, number> = {}
  for (const lead of allLeads) {
    const key = String(lead.pipeline_id)
    leadsByPipeline[key] = (leadsByPipeline[key] ?? 0) + 1
  }

  // Count leads by manager (responsible_user_id)
  const managerIds = (process.env.AMOCRM_MANAGERS_IDS ?? '').split(',').map(s => Number(s.trim()))
  const leadsByManager: Record<string, number> = {}
  for (const lead of allLeads) {
    if (managerIds.includes(lead.responsible_user_id)) {
      const key = String(lead.responsible_user_id)
      leadsByManager[key] = (leadsByManager[key] ?? 0) + 1
    }
  }

  // Active leads by manager (closed_at === null)
  const activeByManager: Record<string, number> = {}
  for (const lead of allLeads.filter(l => l.closed_at === null && l.status_id !== 142 && l.status_id !== 143)) {
    if (managerIds.includes(lead.responsible_user_id)) {
      const key = String(lead.responsible_user_id)
      activeByManager[key] = (activeByManager[key] ?? 0) + 1
    }
  }

  // Note types seen today
  const noteTypes: Record<number, number> = {}
  for (const n of todayNotes) {
    noteTypes[n.note_type] = (noteTypes[n.note_type] ?? 0) + 1
  }

  return NextResponse.json({
    pipelines: pipelines.map(p => ({
      id:   p.id,
      name: p.name,
      stagesCount: p._embedded?.statuses?.length ?? 0,
      stages: (p._embedded?.statuses ?? []).map(s => ({ id: s.id, name: s.name })),
    })),
    totalLeads:     allLeads.length,
    leadsByPipeline,
    leadsByManager,
    activeByManager,
    todayNotesCount:  todayNotes.length,
    noteTypesToday:   noteTypes,
    sampleNotes: todayNotes.slice(0, 10).map(n => ({
      id: n.id, entity_id: n.entity_id, note_type: n.note_type, created_by: n.created_by,
    })),
    managerIdsFromEnv: managerIds,
    envPipelineId: process.env.AMOCRM_SALES_PIPELINE_ID ?? '(не задан)',
  })
}
