import 'server-only'
import { amoGetAll, getUsers, type AmoLead } from '@/lib/amocrm'
import { buildAmoActivity, type AmoActivityEvent, type AmoCallNote, type AmoActivityReport } from '@/lib/amoActivity'

// Сбор данных для lib/amoActivity.ts. Только GET к AmoCRM.

const DAY = 86400

async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += size) out.push(...await Promise.all(items.slice(i, i + size).map(fn)))
  return out
}

export type ActivityRaw = {
  users: { id: number; name: string }[]
  events: AmoActivityEvent[]
  callNotes: AmoCallNote[]
  leads: AmoLead[]
}

export async function fetchAmoActivity(from: number, to: number): Promise<AmoActivityReport> {
  return buildFromRaw(from, to, await fetchActivityRaw(from, to))
}

export function buildFromRaw(from: number, to: number, raw: ActivityRaw): AmoActivityReport {
  return buildAmoActivity({
    from, to,
    users: raw.users,
    events: raw.events,
    callNotes: raw.callNotes,
    leadResponsible: new Map(raw.leads.map(l => [l.id, l.responsible_user_id])),
  })
}

// Сырые события периода — их же читает «Мой день» (lib/coaching/collect.ts), чтобы не ходить в amo дважды
export async function fetchActivityRaw(from: number, to: number): Promise<ActivityRaw> {
  const dayStarts: number[] = []
  for (let t = from; t < to; t += DAY) dayStarts.push(t)

  // события — посуточно, по три суток параллельно: лимит amo 7 запросов в секунду
  const [users, eventsByDay, callNotesByEntity] = await Promise.all([
    getUsers(),
    inBatches(dayStarts, 3, a => amoGetAll<AmoActivityEvent>('/events', {
      'filter[created_at][from]': String(a),
      'filter[created_at][to]': String(Math.min(a + DAY, to) - 1),
    }, 'events')),
    // заметки amo фильтрует по updated_at, created_at игнорирует — отсекаем по created_at сами
    Promise.all(['leads', 'contacts', 'companies'].map(entity => amoGetAll<AmoCallNote>(`/${entity}/notes`, {
      'filter[note_type][]': ['call_in', 'call_out'],
      'filter[updated_at][from]': String(from),
    }, 'notes'))),
  ])
  const events = eventsByDay.flat()

  const leadIds = [...new Set(events
    .filter(e => (e.type === 'incoming_chat_message' || e.type === 'outgoing_chat_message') && e.entity_type === 'lead')
    .map(e => e.entity_id))]
  const idChunks: number[][] = []
  for (let i = 0; i < leadIds.length; i += 200) idChunks.push(leadIds.slice(i, i + 200))
  const leads = (await inBatches(idChunks, 3, ids =>
    amoGetAll<AmoLead>('/leads', { 'filter[id][]': ids.map(String) }, 'leads'))).flat()

  return { users: users.map(u => ({ id: u.id, name: u.name })), events, callNotes: callNotesByEntity.flat(), leads }
}
