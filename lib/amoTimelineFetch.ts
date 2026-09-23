import 'server-only'
import { amoGetAll, getDomain, getPipelines } from '@/lib/amocrm'
import { getAmoUserNames } from '@/lib/amoPeople'
import { missedCallNoteIds, type AmoActivityEvent, type AmoCallNote } from '@/lib/amoActivity'
import { buildTimeline, type EntityName, type TimelineItem } from '@/lib/amoTimeline'

// Данные для ленты «что именно делал» за один день. Только GET к AmoCRM.

type Note = AmoCallNote & { params?: { text?: string; duration?: number; call_status?: number | null } | null }
type Task = { id: number; text?: string; entity_id?: number; entity_type?: string }
type Named = { id: number; name: string }
type Field = { id: number; name: string }

const ENTITY_PATH: Record<string, string> = { lead: 'leads', contact: 'contacts', company: 'companies' }

export async function fetchTimeline(userId: number, from: number, to: number): Promise<TimelineItem[]> {
  const domain = getDomain()
  const [events, pipelines, users] = await Promise.all([
    amoGetAll<AmoActivityEvent>('/events', {
      'filter[created_at][from]': String(from),
      'filter[created_at][to]': String(to - 1),
      'filter[created_by][]': [String(userId)],
    }, 'events'),
    getPipelines(),
    getAmoUserNames(),
  ])
  if (events.length === 0) return []

  const notes = (await Promise.all(['leads', 'contacts', 'companies'].map(entity => amoGetAll<Note>(`/${entity}/notes`, {
    'filter[note_type][]': ['call_in', 'call_out', 'common'],
    'filter[updated_at][from]': String(from - 86400),
  }, 'notes')))).flat()

  const byType = (t: string) => [...new Set(events.filter(e => e.entity_type === t).map(e => e.entity_id))]
  const taskIds = byType('task')
  const tasks = taskIds.length ? await amoGetAll<Task>('/tasks', { 'filter[id][]': taskIds.map(String) }, 'tasks') : []

  const wanted: Record<string, Set<number>> = { lead: new Set(byType('lead')), contact: new Set(byType('contact')), company: new Set(byType('company')) }
  for (const t of tasks) if (t.entity_id && t.entity_type && ENTITY_PATH[t.entity_type.replace(/s$/, '')]) {
    wanted[t.entity_type.replace(/s$/, '')]?.add(t.entity_id)
  }

  const names = new Map<string, EntityName>()
  for (const [kind, ids] of Object.entries(wanted)) {
    if (ids.size === 0) continue
    const path = ENTITY_PATH[kind]
    const list = await amoGetAll<Named>(`/${path}`, { 'filter[id][]': [...ids].map(String) }, path)
    for (const x of list) names.set(`${kind}:${x.id}`, { name: x.name, url: `https://${domain}/${path}/detail/${x.id}` })
  }
  // задача показывается своим текстом, а ссылка ведёт на карточку, к которой она привязана
  for (const t of tasks) {
    const kind = t.entity_type?.replace(/s$/, '') ?? ''
    const card = t.entity_id ? names.get(`${kind}:${t.entity_id}`) : undefined
    names.set(`task:${t.id}`, { name: (t.text ?? '').slice(0, 80) || card?.name || 'задача', url: card?.url ?? null })
  }

  const fields = (await Promise.all(['leads', 'contacts'].map(e =>
    amoGetAll<Field>(`/${e}/custom_fields`, {}, 'custom_fields').catch(() => [])))).flat()

  const stageNames = new Map<string, string>()
  for (const p of pipelines) for (const s of p._embedded.statuses) stageNames.set(`${p.id}:${s.id}`, `${p.name} → ${s.name}`)

  return buildTimeline({
    events, userId, from, to,
    callNotes: notes,
    notesById: new Map(notes.map(n => [n.id, n])),
    missedNoteIds: missedCallNoteIds(notes.filter(n => n.created_at >= from && n.created_at < to)),
    names,
    stageNames,
    users: new Map(users.map(u => [u.id, u.name])),
    fieldNames: new Map(fields.map(f => [f.id, f.name])),
  })
}
