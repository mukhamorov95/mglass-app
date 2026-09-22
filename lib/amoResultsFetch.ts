import 'server-only'
import { amoGetAll, getPipelines, getUsers } from '@/lib/amocrm'
import {
  advanceOf, buildAmoResults, stageId,
  type AmoResultsReport, type ContactEvent, type OpenTask, type ResultLead, type StatusEvent,
} from '@/lib/amoResults'

// Сбор данных для lib/amoResults.ts. Только GET к AmoCRM.

const WEEK = 7 * 86400

async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += size) out.push(...await Promise.all(items.slice(i, i + size).map(fn)))
  return out
}

function weeks(from: number, to: number) {
  const out: [number, number][] = []
  for (let a = from; a < to; a += WEEK) out.push([a, Math.min(a + WEEK, to) - 1])
  return out
}

const eventsOfType = (types: string[], from: number, to: number) =>
  inBatches(weeks(from, to), 3, ([a, b]) => amoGetAll<StatusEvent & ContactEvent>('/events', {
    'filter[type][]': types,
    'filter[created_at][from]': String(a),
    'filter[created_at][to]': String(b),
  }, 'events')).then(parts => parts.flat())

export async function fetchAmoResults(from: number, to: number): Promise<AmoResultsReport> {
  const now = Math.floor(Date.now() / 1000)
  // Последовательно по группам: всё разом — это больше 7 запросов в секунду, и amo режет 429
  const [users, pipelines] = await Promise.all([getUsers(), getPipelines()])
  const statusEvents = await eventsOfType(['lead_status_changed'], from, to)
  const contacts = await eventsOfType(['outgoing_chat_message', 'outgoing_call'], from, to)
  const [newLeads, openTasks] = await Promise.all([
    amoGetAll<ResultLead>('/leads', { 'filter[created_at][from]': String(from), 'filter[created_at][to]': String(to - 1) }, 'leads'),
    amoGetAll<OpenTask>('/tasks', { 'filter[is_completed]': '0' }, 'tasks'),
  ])

  const stageNames = new Map<string, string>()
  for (const p of pipelines) for (const s of p._embedded.statuses) stageNames.set(stageId(p.id, s.id), s.name)

  const paidIds = [...new Set(statusEvents.filter(e => advanceOf(e, stageNames) === 'paid').map(e => e.entity_id))]
  const chunks: number[][] = []
  for (let i = 0; i < paidIds.length; i += 200) chunks.push(paidIds.slice(i, i + 200))
  const paidLeads = (await inBatches(chunks, 3, ids =>
    amoGetAll<ResultLead>('/leads', { 'filter[id][]': ids.map(String) }, 'leads'))).flat()

  return buildAmoResults({
    from, to, now,
    users: users.map(u => ({ id: u.id, name: u.name })),
    stageNames, statusEvents, newLeads, paidLeads, contacts, openTasks,
  })
}
