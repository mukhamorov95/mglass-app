import 'server-only'
import { amoGetAll, getDomain, getPipelines } from '@/lib/amocrm'
import { getAmoUserNames } from '@/lib/amoPeople'
import { dropAutoReplies, replyEpisodes, type AmoActivityEvent } from '@/lib/amoActivity'
import { isWorkingDaytime, stageId, type StatusEvent } from '@/lib/amoResults'
import { WAIT_MIN } from '@/lib/coaching/focus'
import { fetchPbxReport } from '@/lib/pbxCallsFetch'
import type { LeadDayFacts } from '@/lib/dayNotes/rules'

// Факты для вечернего разбора: заявки «Продаж», созданные в окне, их переписка, звонки,
// переводы по этапам, ближайшая открытая задача и пропущенные из журнала АТС. Только GET к amo.
// «Касание» — то же, что в «Моём дне»: исходящее сообщение или исходящий звонок, от кого бы ни было;
// автоответ робота — не касание (общее правило dropAutoReplies).

const SALES = 'продажи'
const WON = 142
const LOST = 143
const TOUCH = new Set(['outgoing_chat_message', 'outgoing_call'])
const EVENT_TYPES = ['incoming_chat_message', 'outgoing_chat_message', 'outgoing_call', 'lead_status_changed']

type Lead = {
  id: number; name: string; status_id: number; pipeline_id: number; responsible_user_id: number; created_at: number
  _embedded?: { contacts?: { id: number }[] }
}
type Task = { entity_id: number; complete_till: number; text?: string }

const chunks = <T,>(items: T[], size: number) => {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => { const l = m.get(k); if (l) l.push(v); else m.set(k, [v]) }

export type DayFacts = { facts: LeadDayFacts[]; noDealMissed: number }

export async function collectDayFacts(from: number, now: number): Promise<DayFacts> {
  const domain = getDomain()
  const [pipelines, users] = await Promise.all([getPipelines(), getAmoUserNames()])
  const sales = pipelines.find(p => p.name.trim().toLowerCase() === SALES)
  if (!sales) throw new Error('В amo нет воронки «Продажи»')
  const stageName = new Map<string, string>()
  for (const p of pipelines) for (const s of p._embedded.statuses) stageName.set(stageId(p.id, s.id), s.name)
  const nameOf = new Map(users.map(u => [u.id, u.name]))

  const leads = (await amoGetAll<Lead>('/leads', {
    'filter[created_at][from]': String(from),
    'filter[created_at][to]': String(now),
    with: 'contacts',
  }, 'leads')).filter(l => l.pipeline_id === sales.id)

  const pbx = await fetchPbxReport(from, now).catch((e: unknown) => {
    console.error('[dayNotes] журнал АТС не прочитан', e)
    return null
  })
  const missed = pbx?.configured ? pbx.missed : []
  const leadIds = new Set(leads.map(l => l.id))
  const noDealMissed = missed.filter(m => m.after === null && m.owner.kind !== 'deal').length
  if (leads.length === 0) return { facts: [], noDealMissed }

  const events = dropAutoReplies(await amoGetAll<AmoActivityEvent>('/events', {
    'filter[type][]': EVENT_TYPES,
    'filter[created_at][from]': String(from),
    'filter[created_at][to]': String(now),
  }, 'events'), new Map(leads.map(l => [l.id, l.created_at])))

  const tasks: Task[] = []
  for (const ids of chunks([...leadIds], 200)) {
    tasks.push(...await amoGetAll<Task>('/tasks', {
      'filter[is_completed]': '0',
      'filter[entity_type]': 'leads',
      'filter[entity_id][]': ids.map(String),
    }, 'tasks'))
  }

  const leadsOfContact = new Map<number, number[]>()
  for (const l of leads) for (const c of l._embedded?.contacts ?? []) push(leadsOfContact, c.id, l.id)
  const leadsOf = (e: AmoActivityEvent) =>
    e.entity_type === 'lead' ? (leadIds.has(e.entity_id) ? [e.entity_id] : [])
      : e.entity_type === 'contact' ? leadsOfContact.get(e.entity_id) ?? [] : []

  const touches = new Map<number, number[]>()
  const moves = new Map<number, StatusEvent[]>()
  for (const e of events) {
    if (TOUCH.has(e.type)) for (const id of leadsOf(e)) push(touches, id, e.created_at)
    if (e.type === 'lead_status_changed' && e.entity_type === 'lead' && leadIds.has(e.entity_id)) {
      push(moves, e.entity_id, e as unknown as StatusEvent)
    }
  }
  const touchedAfter = (leadId: number, ts: number) => (touches.get(leadId) ?? []).some(t => t >= ts)

  const waiting = new Map<number, number>()
  for (const ep of replyEpisodes(events)) {
    if (ep.replyAt !== null || !ep.leadId || !leadIds.has(ep.leadId) || ep.startAt > now - WAIT_MIN) continue
    if (touchedAfter(ep.leadId, ep.startAt)) continue
    const prev = waiting.get(ep.leadId)
    if (prev === undefined || ep.startAt < prev) waiting.set(ep.leadId, ep.startAt)
  }

  const nextTask = new Map<number, Task>()
  for (const t of tasks) {
    const prev = nextTask.get(t.entity_id)
    if (!prev || t.complete_till < prev.complete_till) nextTask.set(t.entity_id, t)
  }

  const missedByLead = new Map<number, LeadDayFacts['missed']>()
  for (const m of missed) {
    if (m.owner.kind === 'deal' && leadIds.has(m.owner.leadId)) {
      push(missedByLead, m.owner.leadId, { at: m.at, attempts: m.attempts, after: m.after ? { at: m.after.at, what: m.after.what } : null })
    }
  }

  const stage = (pipelineId: number, statusId: number) => stageName.get(stageId(pipelineId, statusId)) ?? `этап ${statusId}`
  const facts = leads.map((l): LeadDayFacts => {
    const first = (moves.get(l.id) ?? []).sort((a, b) => a.created_at - b.created_at)[0]
    const before = first?.value_before?.[0]?.lead_status
    const touch = (touches.get(l.id) ?? []).filter(t => t >= l.created_at)
    const task = nextTask.get(l.id)
    return {
      leadId: l.id,
      name: l.name || `Сделка #${l.id}`,
      url: `https://${domain}/leads/detail/${l.id}`,
      responsibleId: l.responsible_user_id,
      responsible: nameOf.get(l.responsible_user_id) ?? `пользователь ${l.responsible_user_id}`,
      createdAt: l.created_at,
      daytime: isWorkingDaytime(l.created_at),
      stageAtStart: before ? stage(before.pipeline_id, before.id) : null,
      stageNow: stage(l.pipeline_id, l.status_id),
      closed: l.status_id === WON ? 'won' : l.status_id === LOST ? 'lost' : null,
      firstTouchAt: touch.length ? Math.min(...touch) : null,
      waitingSince: waiting.get(l.id) ?? null,
      missed: missedByLead.get(l.id) ?? [],
      task: task ? { text: task.text ?? '', dueAt: task.complete_till } : null,
    }
  }).sort((a, b) => a.createdAt - b.createdAt)

  return { facts, noDealMissed }
}
