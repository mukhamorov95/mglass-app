import 'server-only'
import { amoGetAll, getDomain, getPipelines, type AmoLead } from '@/lib/amocrm'
import { replyEpisodes, type AmoActivityEvent } from '@/lib/amoActivity'
import { stageKey } from '@/lib/amoResults'
import { fetchPbxReport, type PbxReport } from '@/lib/pbxCallsFetch'
import type { LeadFact, MissedFact } from '@/lib/coaching/rules'

// Поводы «Сделай сегодня» — отдельно от недельных и 90-дневных цифр, потому что их нужно
// уметь пересчитать по одному человеку за секунды: утренний список к обеду устаревает
// (перезвонил, а пункт висит). Полный сбор живёт в lib/coaching/collect.ts.

const DAY = 86400
const WAIT_MIN = 20 * 60          // меньше 20 минут без ответа — ещё не «ждёт»
const HOT_SILENCE = 3 * DAY       // горячая сделка без касания три дня — пора напомнить о себе
const CHAT_TYPES = ['incoming_chat_message', 'outgoing_chat_message', 'outgoing_call']

export type Lead = AmoLead & { price?: number | null; name: string }
export type Task = { responsible_user_id: number; complete_till: number; text?: string; entity_id?: number; entity_type?: string }

export type FocusFacts = {
  missed: MissedFact[]
  waiting: LeadFact[]
  newLeads: LeadFact[]
  hotDeals: (LeadFact & { lastTouchAt: number | null })[]
  overdue: { count: number; older30: number; oldest: { text: string; dueAt: number; url: string | null } | null }
}

export const emptyFocus = (): FocusFacts => ({ missed: [], waiting: [], newLeads: [], hotDeals: [], overdue: { count: 0, older30: 0, oldest: null } })

export type FocusInput = {
  ids: Set<number>
  now: number
  events: AmoActivityEvent[]
  leadsById: Map<number, Lead>
  stageName: Map<string, string>
  hotLeads: Lead[]
  newLeads: Lead[]
  tasks: Task[]
  pbx: PbxReport | null
  domain: string
}

export function focusFacts(input: FocusInput): Map<number, FocusFacts> {
  const { ids, now, domain } = input
  const out = new Map<number, FocusFacts>()
  for (const id of ids) out.set(id, emptyFocus())

  const leadUrl = (id: number) => `https://${domain}/leads/detail/${id}`
  const stageOf = (l: Lead) => input.stageName.get(`${l.pipeline_id}:${l.status_id}`) ?? `этап ${l.status_id}`
  const closed = (l: { status_id: number }) => l.status_id === 142 || l.status_id === 143

  const outgoingByLead = new Map<number, number[]>()
  for (const e of input.events) {
    if (e.entity_type !== 'lead' || (e.type !== 'outgoing_chat_message' && e.type !== 'outgoing_call')) continue
    const list = outgoingByLead.get(e.entity_id) ?? []
    list.push(e.created_at)
    outgoingByLead.set(e.entity_id, list)
  }
  const touchedAfter = (leadId: number, ts: number) => (outgoingByLead.get(leadId) ?? []).some(t => t >= ts)
  const lastTouch = (leadId: number) => { const l = outgoingByLead.get(leadId); return l?.length ? Math.max(...l) : null }

  // клиент ждёт ответа: писал и не получил ни сообщения, ни звонка
  const waitingByLead = new Map<number, { owner: number; fact: LeadFact }>()
  for (const ep of replyEpisodes(input.events)) {
    if (ep.replyAt !== null || !ep.leadId || ep.startAt < now - 3 * DAY || ep.startAt > now - WAIT_MIN) continue
    const lead = input.leadsById.get(ep.leadId)
    if (!lead || closed(lead) || !ids.has(lead.responsible_user_id)) continue
    if (touchedAfter(lead.id, ep.startAt)) continue
    const prev = waitingByLead.get(lead.id)
    if (!prev || ep.startAt < prev.fact.at) {
      waitingByLead.set(lead.id, {
        owner: lead.responsible_user_id,
        fact: { leadId: lead.id, leadName: lead.name, stage: stageOf(lead), url: leadUrl(lead.id), at: ep.startAt },
      })
    }
  }
  for (const { owner, fact } of waitingByLead.values()) out.get(owner)?.waiting.push(fact)

  const missed = input.pbx && input.pbx.configured ? input.pbx.missed.filter(m => m.after === null) : []
  for (const id of ids) {
    const facts = out.get(id)!
    facts.missed = missed
      .filter(m => {
        if (m.owner.kind !== 'none' && !m.owner.autoCreated) return m.owner.responsibleId === id
        return m.rangToIds.includes(id) || (m.owner.kind !== 'none' && m.owner.responsibleId === id)
      })
      .map(m => ({
        phone: m.phone, at: m.at, attempts: m.attempts,
        leadId: m.owner.kind === 'deal' ? m.owner.leadId : null,
        leadName: m.owner.kind === 'deal' ? m.owner.leadName : null,
        stage: m.owner.kind === 'deal' ? m.owner.stage : null,
        url: m.owner.kind === 'none' ? null : m.owner.url,
        kind: m.owner.kind === 'none' ? 'none' : m.owner.autoCreated ? 'new' : 'deal',
      }))
    facts.newLeads = input.newLeads
      .filter(l => l.responsible_user_id === id && !closed(l) && l.created_at <= now - WAIT_MIN && !touchedAfter(l.id, l.created_at))
      .map(l => ({ leadId: l.id, leadName: l.name, stage: stageOf(l), url: leadUrl(l.id), at: l.created_at }))
    facts.hotDeals = input.hotLeads
      .filter(l => l.responsible_user_id === id)
      .map(l => ({ leadId: l.id, leadName: l.name, stage: stageOf(l), url: leadUrl(l.id), at: l.updated_at, price: l.price ?? 0, lastTouchAt: lastTouch(l.id) }))
      .filter(l => l.lastTouchAt === null || now - l.lastTouchAt >= HOT_SILENCE)
    const myTasks = input.tasks.filter(t => t.responsible_user_id === id && t.complete_till < now).sort((a, b) => a.complete_till - b.complete_till)
    const oldest = myTasks[0]
    facts.overdue = {
      count: myTasks.length,
      older30: myTasks.filter(t => now - t.complete_till > 30 * DAY).length,
      oldest: oldest ? {
        text: (oldest.text ?? '').slice(0, 80), dueAt: oldest.complete_till,
        url: oldest.entity_id && oldest.entity_type ? `https://${domain}/${oldest.entity_type}/detail/${oldest.entity_id}` : null,
      } : null,
    }
  }
  return out
}

// Справочники этапов: названия и какие этапы считаем «горячими» (КП, счёт)
export async function stageMaps() {
  const pipelines = await getPipelines()
  const stageName = new Map<string, string>()
  const hot: { pipeline: number; status: number }[] = []
  for (const p of pipelines) for (const s of p._embedded.statuses) {
    stageName.set(`${p.id}:${s.id}`, `${p.name} → ${s.name}`)
    const k = stageKey(s.name, s.id)
    if (k === 'kp' || k === 'invoice') hot.push({ pipeline: p.id, status: s.id })
  }
  return { stageName, hot }
}

export async function fetchHotAndNew(hot: { pipeline: number; status: number }[], now: number) {
  const statusParams: Record<string, string> = {}
  hot.forEach((h, i) => {
    statusParams[`filter[statuses][${i}][pipeline_id]`] = String(h.pipeline)
    statusParams[`filter[statuses][${i}][status_id]`] = String(h.status)
  })
  const hotLeads = hot.length ? await amoGetAll<Lead>('/leads', statusParams, 'leads') : []
  const newLeads = await amoGetAll<Lead>('/leads', { 'filter[created_at][from]': String(now - 3 * DAY) }, 'leads')
  return { hotLeads, newLeads }
}

// Пересчёт поводов по одному человеку — для кнопки «Обновить»: берём только то, что нужно
// для списка, и только за три дня, поэтому укладывается в секунды, а не в минуту.
export async function collectFocusLive(amoUserId: number, now = Math.floor(Date.now() / 1000)): Promise<FocusFacts> {
  const domain = getDomain()
  const { stageName, hot } = await stageMaps()
  const events = await amoGetAll<AmoActivityEvent>('/events', {
    'filter[type][]': CHAT_TYPES,
    'filter[created_at][from]': String(now - 3 * DAY),
  }, 'events')

  const leadIds = [...new Set(events.filter(e => e.entity_type === 'lead').map(e => e.entity_id))]
  const chunks: number[][] = []
  for (let i = 0; i < leadIds.length; i += 200) chunks.push(leadIds.slice(i, i + 200))
  const leads: Lead[] = []
  for (const ids of chunks) leads.push(...await amoGetAll<Lead>('/leads', { 'filter[id][]': ids.map(String) }, 'leads'))

  const { hotLeads, newLeads } = await fetchHotAndNew(hot, now)
  const tasks = await amoGetAll<Task>('/tasks', { 'filter[is_completed]': '0', 'filter[responsible_user_id][]': [String(amoUserId)] }, 'tasks')
  const pbx = await fetchPbxReport(now - 2 * DAY, now).catch(() => null)

  return focusFacts({
    ids: new Set([amoUserId]), now, events,
    leadsById: new Map(leads.map(l => [l.id, l])),
    stageName, hotLeads, newLeads, tasks, pbx, domain,
  }).get(amoUserId) ?? emptyFocus()
}
