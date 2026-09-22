import 'server-only'
import { amoGetAll, getDomain, getPipelines, type AmoLead } from '@/lib/amocrm'
import { mskDay, mskDayStart, replyEpisodes } from '@/lib/amoActivity'
import { buildFromRaw, fetchActivityRaw } from '@/lib/amoActivityFetch'
import { fetchAmoResults } from '@/lib/amoResultsFetch'
import { stageKey } from '@/lib/amoResults'
import { fetchPbxReport } from '@/lib/pbxCallsFetch'
import type { MissedClient } from '@/lib/missedClients'
import { coach, type Coaching, type LeadFact, type ManagerFacts, type MissedFact } from '@/lib/coaching/rules'

// Сбор фактов для «Моего дня» по всем менеджерам сразу: медиана команды нужна каждому.
// Только GET к AmoCRM. Порядок последовательный — лимит amo 7 запросов в секунду, а полный
// сбор это около минуты запросов: поэтому он живёт в кроне, а не на открытии страницы.

const DAY = 86400
const WAIT_MIN = 20 * 60          // меньше 20 минут без ответа — ещё не «ждёт»
const HOT_SILENCE = 3 * DAY       // горячая сделка без касания три дня — пора напомнить о себе

type Lead = AmoLead & { price?: number | null; name: string }
type Task = { responsible_user_id: number; complete_till: number; text?: string; entity_id?: number; entity_type?: string }

export type CoachingRun = { computedAt: number; coachings: Coaching[]; unassignedMissed: MissedClient[] }

export async function collectCoaching(managers: { id: number; name: string }[], now = Math.floor(Date.now() / 1000)): Promise<CoachingRun> {
  const domain = getDomain()
  const todayStart = mskDayStart(mskDay(now))
  const weekFrom = todayStart - 7 * DAY
  const ids = new Set(managers.map(m => m.id))

  const raw = await fetchActivityRaw(weekFrom, now)
  const week = buildFromRaw(weekFrom, now, raw)
  const results = await fetchAmoResults(todayStart - 90 * DAY, todayStart)
  const pbx = await fetchPbxReport(todayStart - DAY, now).catch(() => null)

  const pipelines = await getPipelines()
  const stageName = new Map<string, string>()
  const hotStatuses: { pipeline: number; status: number }[] = []
  for (const p of pipelines) for (const s of p._embedded.statuses) {
    stageName.set(`${p.id}:${s.id}`, `${p.name} → ${s.name}`)
    const k = stageKey(s.name, s.id)
    if (k === 'kp' || k === 'invoice') hotStatuses.push({ pipeline: p.id, status: s.id })
  }
  const statusParams: Record<string, string> = {}
  hotStatuses.forEach((h, i) => {
    statusParams[`filter[statuses][${i}][pipeline_id]`] = String(h.pipeline)
    statusParams[`filter[statuses][${i}][status_id]`] = String(h.status)
  })
  const hotLeads = hotStatuses.length ? await amoGetAll<Lead>('/leads', statusParams, 'leads') : []
  const newLeads = await amoGetAll<Lead>('/leads', { 'filter[created_at][from]': String(now - 3 * DAY) }, 'leads')
  const tasks = await amoGetAll<Task>('/tasks', { 'filter[is_completed]': '0' }, 'tasks')

  const leadUrl = (id: number) => `https://${domain}/leads/detail/${id}`
  const stageOf = (l: Lead) => stageName.get(`${l.pipeline_id}:${l.status_id}`) ?? `этап ${l.status_id}`
  const closed = (l: { status_id: number }) => l.status_id === 142 || l.status_id === 143

  // исходящие по сделкам за неделю — чтобы понять, был ли контакт
  const outgoingByLead = new Map<number, number[]>()
  for (const e of raw.events) {
    if (e.entity_type !== 'lead' || (e.type !== 'outgoing_chat_message' && e.type !== 'outgoing_call')) continue
    const list = outgoingByLead.get(e.entity_id) ?? []
    list.push(e.created_at)
    outgoingByLead.set(e.entity_id, list)
  }
  const touchedAfter = (leadId: number, ts: number) => (outgoingByLead.get(leadId) ?? []).some(t => t >= ts)
  const lastTouch = (leadId: number) => { const l = outgoingByLead.get(leadId); return l?.length ? Math.max(...l) : null }

  const chatLeads = new Map(raw.leads.map(l => [l.id, l as Lead]))
  const waitingByUser = new Map<number, Map<number, LeadFact>>()
  for (const ep of replyEpisodes(raw.events)) {
    if (ep.replyAt !== null || !ep.leadId || ep.startAt < now - 3 * DAY || ep.startAt > now - WAIT_MIN) continue
    const lead = chatLeads.get(ep.leadId)
    if (!lead || closed(lead) || !ids.has(lead.responsible_user_id)) continue
    // ответили звонком, а не сообщением — клиент не ждёт
    if (touchedAfter(lead.id, ep.startAt)) continue
    const byLead = waitingByUser.get(lead.responsible_user_id) ?? new Map<number, LeadFact>()
    const prev = byLead.get(lead.id)
    if (!prev || ep.startAt < prev.at) byLead.set(lead.id, { leadId: lead.id, leadName: lead.name, stage: stageOf(lead), url: leadUrl(lead.id), at: ep.startAt })
    waitingByUser.set(lead.responsible_user_id, byLead)
  }

  const missedFor = (id: number): MissedFact[] => (pbx && pbx.configured ? pbx.missed : [])
    .filter(m => m.after === null)
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
  const unassignedMissed = (pbx && pbx.configured ? pbx.missed : [])
    .filter(m => m.after === null && m.owner.kind === 'none' && m.rangToIds.length === 0)

  const facts: ManagerFacts[] = managers.map(({ id, name }) => {
    const w = week.managers.find(m => m.userId === id)
    const r = results.managers.find(m => m.userId === id)
    const myTasks = tasks.filter(t => t.responsible_user_id === id && t.complete_till < now).sort((a, b) => a.complete_till - b.complete_till)
    const oldest = myTasks[0]
    return {
      amoUserId: id,
      name,
      week: {
        replies: w ? w.days.flatMap(d => d.replyMinutes) : [],
        leftWaiting: w?.total.leftWaiting ?? 0,
        tasksCompleted: w?.total.tasksCompleted ?? 0,
        workDays: w?.workDays ?? 0,
      },
      results: {
        days: 90,
        leadsReceived: r?.leadsReceived ?? 0, leadsDaytime: r?.leadsDaytime ?? 0, leadsNoContact: r?.leadsNoContact ?? 0,
        firstContactMedianMin: r?.firstContactMedianMin ?? null, paidDeals: r?.paidDeals ?? 0, paidBudget: r?.paidBudget ?? 0,
      },
      missed: missedFor(id),
      waiting: [...(waitingByUser.get(id)?.values() ?? [])],
      newLeads: newLeads
        .filter(l => l.responsible_user_id === id && !closed(l) && l.created_at <= now - WAIT_MIN && !touchedAfter(l.id, l.created_at))
        .map(l => ({ leadId: l.id, leadName: l.name, stage: stageOf(l), url: leadUrl(l.id), at: l.created_at })),
      hotDeals: hotLeads
        .filter(l => l.responsible_user_id === id)
        .map(l => ({ leadId: l.id, leadName: l.name, stage: stageOf(l), url: leadUrl(l.id), at: l.updated_at, price: l.price ?? 0, lastTouchAt: lastTouch(l.id) }))
        .filter(l => l.lastTouchAt === null || now - l.lastTouchAt >= HOT_SILENCE),
      overdue: {
        count: myTasks.length,
        older30: myTasks.filter(t => now - t.complete_till > 30 * DAY).length,
        oldest: oldest ? {
          text: (oldest.text ?? '').slice(0, 80), dueAt: oldest.complete_till,
          url: oldest.entity_id && oldest.entity_type ? `https://${domain}/${oldest.entity_type}/detail/${oldest.entity_id}` : null,
        } : null,
      },
    }
  })

  return { computedAt: now, coachings: facts.map(f => coach(f, facts, now)), unassignedMissed }
}
