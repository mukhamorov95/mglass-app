import 'server-only'
import { amoGetAll, getPipelines } from '@/lib/amocrm'
import { getAmoUserNames } from '@/lib/amoPeople'
import { mayBeAutoReply } from '@/lib/amoActivity'
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

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function weeks(from: number, to: number) {
  const out: [number, number][] = []
  for (let a = from; a < to; a += WEEK) out.push([a, Math.min(a + WEEK, to) - 1])
  return out
}

const eventsOfType = <T>(types: string[], from: number, to: number) =>
  inBatches(weeks(from, to), 3, ([a, b]) => amoGetAll<T>('/events', {
    'filter[type][]': types,
    'filter[created_at][from]': String(a),
    'filter[created_at][to]': String(b),
  }, 'events')).then(parts => parts.flat())

export async function fetchAmoResults(from: number, to: number): Promise<AmoResultsReport> {
  const now = Math.floor(Date.now() / 1000)
  // Последовательно по группам: всё разом — это больше 7 запросов в секунду, и amo режет 429
  const [users, pipelines] = await Promise.all([getAmoUserNames(), getPipelines()])
  const statusEvents = await eventsOfType<StatusEvent>(['lead_status_changed'], from, to)
  const touches = await eventsOfType<ContactEvent>(['outgoing_chat_message', 'outgoing_call'], from, to)
  const [newLeads, openTasks] = await Promise.all([
    amoGetAll<ResultLead>('/leads', { 'filter[created_at][from]': String(from), 'filter[created_at][to]': String(to - 1) }, 'leads'),
    amoGetAll<OpenTask>('/tasks', { 'filter[is_completed]': '0' }, 'tasks'),
  ])

  // Входящие нужны только чтобы узнать автоответ робота — и только по новым заявкам, где он
  // мог стать «первым контактом». Все входящие за 90 дней — вдвое дольше (замер 30.09:
  // 25 → 52 с). amo фильтрует по 10 сделок за запрос.
  const fresh = new Set(newLeads.map(l => l.id))
  const suspects = [...new Set(touches
    .filter(e => mayBeAutoReply(e) && e.entity_type === 'lead' && fresh.has(e.entity_id))
    .map(e => e.entity_id))]
  const incoming = (await inBatches(chunks(suspects, 10), 3, ids => amoGetAll<ContactEvent>('/events', {
    'filter[entity]': 'lead',
    'filter[entity_id][]': ids.map(String),
    'filter[type][]': ['incoming_chat_message'],
    'filter[created_at][from]': String(from),
    'filter[created_at][to]': String(to - 1),
  }, 'events'))).flat()
  const contacts = [...touches, ...incoming]

  const stageNames = new Map<string, string>()
  for (const p of pipelines) for (const s of p._embedded.statuses) stageNames.set(stageId(p.id, s.id), s.name)

  const paidIds = [...new Set(statusEvents.filter(e => advanceOf(e, stageNames) === 'paid').map(e => e.entity_id))]
  const paidLeads = (await inBatches(chunks(paidIds, 200), 3, ids =>
    amoGetAll<ResultLead>('/leads', { 'filter[id][]': ids.map(String) }, 'leads'))).flat()

  return buildAmoResults({
    from, to, now,
    users,
    stageNames, statusEvents, newLeads, paidLeads, contacts, openTasks,
  })
}
