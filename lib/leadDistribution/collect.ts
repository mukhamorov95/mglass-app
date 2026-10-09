import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { amoGetAll, getPipelines } from '@/lib/amocrm'
import { isOwnAction, mskDay, mskDayStart, type AmoActivityEvent } from '@/lib/amoActivity'
import { collectFocusLiveMany } from '@/lib/coaching/focus'
import {
  OUTGOING_REASON, decide, isOutgoingCallLead, knownOwner, normalizePhone, phoneFromLeadName, shiftState,
  type Decision, type Seller, type SellerState,
} from '@/lib/leadDistribution/rules'

// Прогон распределителя: новые заявки «Продаж» за двое суток, которых ещё нет в журнале (или они
// ждали начала смены), → решение по lib/leadDistribution/rules.ts → строка в lead_distribution.
// К amo только GET. Клиент Supabase — service role из крона; прав проверять здесь некому.

const PENDING_WINDOW = 2 * 86400
const PHONE_MEMORY = 30 * 86400
const BACKLOG_SEC = 30 * 60
const WON = 142
const LOST = 143

type Lead = {
  id: number; name: string; status_id: number; pipeline_id: number; responsible_user_id: number; created_at: number
  _embedded?: { contacts?: { id: number }[] }
}
type Contact = {
  id: number
  custom_fields_values?: { field_code?: string; values: { value: string }[] }[] | null
  _embedded?: { leads?: { id: number }[] }
}
type LogRow = { lead_id: number; status: string; chosen_user_id: number | null; decided_at: string | null; phone: string | null; lead_created_at: string }

export type RunResult = {
  pending: number
  decisions: { leadId: number; name: string; decision: Decision }[]
}

const iso = (ts: number) => new Date(ts * 1000).toISOString()
const unix = (s: string) => Math.floor(Date.parse(s) / 1000)
const chunks = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))

// persist: false — посчитать и ничего не записать (проверка руками, ?dry=1 у крона)
export async function runDistribution(sb: SupabaseClient, now = Math.floor(Date.now() / 1000), persist = true): Promise<RunResult> {
  const { data: sched, error } = await sb.from('manager_schedules')
    .select('amo_user_id, name, starts_on, work_from, work_to, work_days').eq('is_seller', true)
  if (error) throw new Error(`Не прочитать графики: ${error.message}`)
  if (!sched?.length) throw new Error('В manager_schedules нет продавцов — распределять некому')
  const sellers: Seller[] = sched.map(s => ({
    id: Number(s.amo_user_id), name: String(s.name), startsOn: s.starts_on,
    workFrom: s.work_from, workTo: s.work_to, workDays: (s.work_days ?? []).map(Number),
  }))
  const sellerIds = new Set(sellers.map(s => s.id))

  const sales = (await getPipelines()).find(p => p.name.trim().toLowerCase() === 'продажи')
  if (!sales) throw new Error('В amo нет воронки «Продажи»')
  const leads = (await amoGetAll<Lead>('/leads', {
    'filter[created_at][from]': String(now - PENDING_WINDOW), with: 'contacts',
  }, 'leads')).filter(l => l.pipeline_id === sales.id)

  const { data: logData, error: logErr } = await sb.from('lead_distribution')
    .select('lead_id, status, chosen_user_id, decided_at, phone, lead_created_at')
    .gte('lead_created_at', iso(now - PHONE_MEMORY))
  if (logErr) throw new Error(`Не прочитать журнал распределения: ${logErr.message}`)
  const log = (logData ?? []) as LogRow[]
  const finished = new Set(log.filter(r => r.status !== 'deferred').map(r => Number(r.lead_id)))
  let pending = leads.filter(l => !finished.has(l.id)).sort((a, b) => a.created_at - b.created_at)
  // Первый прогон: заявки, пришедшие до запуска, не разбираем задним числом — иначе первое вечернее
  // сравнение с ручными назначениями покажет «алгоритм назначил через сутки»
  if (log.length === 0) {
    const backlog = pending.filter(l => l.created_at < now - BACKLOG_SEC)
    if (persist) for (const l of backlog) await save(sb, l, null, { status: 'skipped', reason: 'пришла до запуска распределителя' }, now, [])
    pending = pending.filter(l => l.created_at >= now - BACKLOG_SEC)
  }
  if (pending.length === 0) return { pending: 0, decisions: [] }

  // Счёт справедливости — по журналу решений за сегодня, а не одной ячейкой «чья очередь»
  const todayStart = mskDayStart(mskDay(now))
  const todayCount = new Map<number, number>()
  const lastAssigned = new Map<number, number>()
  const loggedOwner = new Map<number, number>()
  const phoneOwner = new Map<string, { userId: number; at: number }>()
  for (const r of log) {
    if (r.status !== 'decided' || !r.chosen_user_id || !r.decided_at) continue
    const uid = Number(r.chosen_user_id), at = unix(r.decided_at)
    loggedOwner.set(Number(r.lead_id), uid)
    if (r.phone && (!phoneOwner.has(r.phone) || phoneOwner.get(r.phone)!.at < at)) phoneOwner.set(r.phone, { userId: uid, at })
    if (at >= todayStart) todayCount.set(uid, (todayCount.get(uid) ?? 0) + 1)
    lastAssigned.set(uid, Math.max(lastAssigned.get(uid) ?? 0, at))
  }

  // Кто сегодня уже действовал в amo — для «нет на месте» и субботнего дежурного
  const events = await amoGetAll<AmoActivityEvent>('/events', {
    'filter[created_at][from]': String(todayStart),
    'filter[created_by][]': [...sellerIds].map(String),
  }, 'events')
  const firstAction = new Map<number, number>()
  for (const e of events) {
    if (!sellerIds.has(e.created_by) || e.type === 'incoming_call' || !isOwnAction(e, new Set())) continue
    firstAction.set(e.created_by, Math.min(firstAction.get(e.created_by) ?? Infinity, e.created_at))
  }

  // Загрузка — поводы «Моего дня». Заявки, которыми занимается распределитель, в «без касания» не
  // считаем: в тени они висят на ответственном по умолчанию и завысили бы ему загрузку.
  const focus = await collectFocusLiveMany([...sellerIds], now)
  const ours = new Set([...pending.map(l => l.id), ...loggedOwner.keys()])
  const load = new Map([...sellerIds].map(id => {
    const f = focus.get(id)
    return [id, {
      waiting: f?.waiting.length ?? 0,
      missed: f?.missed.length ?? 0,
      untouched: (f?.newLeads ?? []).filter(x => !ours.has(x.leadId)).length,
    }]
  }))

  const decisions: RunResult['decisions'] = []
  for (const lead of pending) {
    if (lead.status_id === WON || lead.status_id === LOST) {
      if (persist) await save(sb, lead, null, { status: 'skipped', reason: 'закрыта до распределения' }, now, [])
      continue
    }
    if (isOutgoingCallLead(lead.name)) {
      if (persist) await save(sb, lead, phoneFromLeadName(lead.name), { status: 'skipped', reason: OUTGOING_REASON }, now, [])
      continue
    }
    const phones = await leadPhones(lead)
    const phone = phones[0] ?? null
    const byPhone = phones.map(p => phoneOwner.get(p)).find(Boolean)
    let known: { userId: number; name: string } | null = null
    if (byPhone) known = { userId: byPhone.userId, name: nameOf(sellers, byPhone.userId) }
    else {
      const owner = knownOwner(lead.id, await otherLeads(lead, phones), loggedOwner, sellerIds, now)
      if (owner) known = { userId: owner, name: nameOf(sellers, owner) }
    }

    const states: SellerState[] = sellers.map(s => {
      const st = shiftState(s, now, firstAction.get(s.id) ?? null)
      return {
        id: s.id, name: s.name, onShift: st.onShift, offReason: st.why,
        load: load.get(s.id)!, todayCount: todayCount.get(s.id) ?? 0, lastAssignedAt: lastAssigned.get(s.id) ?? null,
      }
    })
    const decision = decide({ known, sellers: states })
    if (persist) await save(sb, lead, phone, decision, now, states)
    decisions.push({ leadId: lead.id, name: lead.name, decision })

    if (decision.status === 'decided') {
      todayCount.set(decision.userId, (todayCount.get(decision.userId) ?? 0) + 1)
      lastAssigned.set(decision.userId, now)
      loggedOwner.set(lead.id, decision.userId)
      for (const p of phones) phoneOwner.set(p, { userId: decision.userId, at: now })
    }
  }
  return { pending: pending.length, decisions }
}

const nameOf = (sellers: Seller[], id: number) => sellers.find(s => s.id === id)?.name ?? `пользователь ${id}`

async function leadPhones(lead: Lead): Promise<string[]> {
  const out = new Set<string>()
  const fromName = phoneFromLeadName(lead.name)
  if (fromName) out.add(fromName)
  const ids = (lead._embedded?.contacts ?? []).map(c => String(c.id))
  if (ids.length) {
    const contacts = await amoGetAll<Contact>('/contacts', { 'filter[id][]': ids }, 'contacts')
    for (const c of contacts) for (const f of c.custom_fields_values ?? []) {
      if (f.field_code !== 'PHONE') continue
      for (const v of f.values) { const p = normalizePhone(v.value); if (p) out.add(p) }
    }
  }
  return [...out]
}

// Другие сделки клиента: через его контакты и поиском по номеру (сделка АТС бывает не привязана к контакту)
async function otherLeads(lead: Lead, phones: string[]): Promise<Lead[]> {
  const byId = new Map<number, Lead>()
  const contactIds = (lead._embedded?.contacts ?? []).map(c => String(c.id))
  const linked: number[] = []
  if (contactIds.length) {
    const contacts = await amoGetAll<Contact>('/contacts', { 'filter[id][]': contactIds, with: 'leads' }, 'contacts')
    for (const c of contacts) for (const l of c._embedded?.leads ?? []) if (l.id !== lead.id) linked.push(l.id)
  }
  for (const ids of chunks([...new Set(linked)], 200)) {
    for (const l of await amoGetAll<Lead>('/leads', { 'filter[id][]': ids.map(String) }, 'leads')) byId.set(l.id, l)
  }
  for (const p of phones) {
    for (const l of await amoGetAll<Lead>('/leads', { query: p }, 'leads')) if (l.id !== lead.id) byId.set(l.id, l)
  }
  return [...byId.values()]
}

async function save(
  sb: SupabaseClient, lead: Lead, phone: string | null,
  d: Decision | { status: 'skipped'; reason: string }, now: number, states: SellerState[],
) {
  const decided = d.status === 'decided'
  const { error } = await sb.from('lead_distribution').upsert({
    lead_id: lead.id,
    lead_name: lead.name || `Сделка #${lead.id}`,
    lead_created_at: iso(lead.created_at),
    phone,
    status: d.status,
    rule: decided ? d.rule : null,
    chosen_user_id: decided ? d.userId : null,
    chosen_name: decided ? d.name : null,
    reason: d.reason,
    sellers: states.map(s => ({ id: s.id, name: s.name, onShift: s.onShift, off: s.offReason, load: s.load, today: s.todayCount })),
    responsible_at_decision: lead.responsible_user_id,
    mode: 'shadow',
    decided_at: decided ? iso(now) : null,
    updated_at: iso(now),
  }, { onConflict: 'lead_id' })
  if (error) throw new Error(`Не записать решение по сделке ${lead.id}: ${error.message}`)
}
