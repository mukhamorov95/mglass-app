// Результат менеджера по AmoCRM: сколько заявок получил, до какого этапа довёл, сколько
// дошло до оплаты, что с задачами. Активность без этого блока вводит в заблуждение:
// на замере 25.08–21.09 самый «короткий день» принёс денег почти как лидер, а человек
// с нормальной активностью не довёл до оплаты ни одной сделки.
// Чистые функции — данные собирает lib/amoResultsFetch.ts.

export type StageKey = 'measure' | 'kp' | 'invoice' | 'paid' | 'won' | 'lost'
export const STAGES: StageKey[] = ['measure', 'kp', 'invoice', 'paid', 'won', 'lost']

type LeadStatusValue = Array<{ lead_status?: { id: number; pipeline_id: number } }> | null
export type StatusEvent = {
  entity_id: number
  created_by: number
  created_at: number
  value_after?: LeadStatusValue
  value_before?: LeadStatusValue
}
export type ResultLead = { id: number; responsible_user_id: number; created_at: number; status_id: number; pipeline_id: number; price?: number | null }
export type OpenTask = { responsible_user_id: number; complete_till: number }
export type ContactEvent = { entity_id: number; entity_type: string; created_at: number }

export type ManagerResult = {
  userId: number
  name: string
  leadsReceived: number
  leadsDaytime: number
  leadsNoContact: number
  firstContactMedianMin: number | null
  advanced: Record<StageKey, number>
  paidDeals: number
  paidBudget: number
  lostOfReceived: number
  tasksOpen: number
  tasksOverdue: number
  tasksOverdue30: number
}

export type AmoResultsReport = { from: number; to: number; managers: ManagerResult[] }

const MSK = 3 * 3600
const DAY = 86400
const WON = 142
const LOST = 143

// По названию этапа, как в lib/salesMonitor.ts: id этапов у каждой воронки свои.
// В «Квалификации» системный 142 называется «Замер запланирован» — это замер, не продажа.
export function stageKey(name: string, statusId: number): StageKey | null {
  const n = name.toLowerCase().replace(/ё/g, 'е')
  if (statusId === LOST) return 'lost'
  if (statusId === WON) return n.includes('замер') ? 'measure' : 'won'
  if (n.includes('замер назнач') || n.includes('замер заплан')) return 'measure'
  if (n.startsWith('кп')) return 'kp'
  if (n.includes('счет выставлен')) return 'invoice'
  if (n.includes('оплата сделана') || n.includes('оплата получена') || n.includes('счет оплачен')) return 'paid'
  return null
}

export const stageId = (pipelineId: number, statusId: number) => `${pipelineId}:${statusId}`

const RANK: Record<StageKey, number> = { measure: 1, kp: 2, invoice: 3, paid: 4, won: 5, lost: 0 }

// Движение вперёд: оплаченную сделку двигают по этапам оплаты («оплата сделана» →
// «счёт оплачен») — это не новая оплата. Засчитываем, только если до перевода сделка
// была на более раннем этапе. Отказ — всегда, если сделка не была уже в отказе.
export function advanceOf(e: StatusEvent, stageNames: Map<string, string>): StageKey | null {
  const key = (v: LeadStatusValue | undefined) => {
    const ls = v?.[0]?.lead_status
    return ls ? stageKey(stageNames.get(stageId(ls.pipeline_id, ls.id)) ?? '', ls.id) : null
  }
  const after = key(e.value_after)
  if (!after) return null
  const before = key(e.value_before)
  if (after === 'lost') return before === 'lost' ? null : 'lost'
  if (before && before !== 'lost' && RANK[before] >= RANK[after]) return null
  return after
}

function isWorkingDaytime(ts: number) {
  const d = new Date((ts + MSK) * 1000)
  const h = d.getUTCHours(), wd = d.getUTCDay()
  return wd >= 1 && wd <= 5 && h >= 9 && h < 19
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

export function buildAmoResults(input: {
  from: number
  to: number
  now: number
  users: { id: number; name: string }[]
  stageNames: Map<string, string>
  statusEvents: StatusEvent[]
  newLeads: ResultLead[]
  paidLeads: ResultLead[]
  contacts: ContactEvent[]
  openTasks: OpenTask[]
}): AmoResultsReport {
  const { from, to, now } = input
  const rows = new Map<number, ManagerResult>()
  const names = new Map(input.users.map(u => [u.id, u.name]))
  const row = (userId: number) => {
    let r = rows.get(userId)
    if (!r) {
      r = {
        userId, name: names.get(userId) ?? `amo #${userId}`, leadsReceived: 0, leadsDaytime: 0, leadsNoContact: 0,
        firstContactMedianMin: null, advanced: { measure: 0, kp: 0, invoice: 0, paid: 0, won: 0, lost: 0 },
        paidDeals: 0, paidBudget: 0, lostOfReceived: 0, tasksOpen: 0, tasksOverdue: 0, tasksOverdue30: 0,
      }
      rows.set(userId, r)
    }
    return r
  }

  // Этап засчитываем тому, кто перевёл сделку, по одному разу на сделку и этап.
  const seen = new Set<string>()
  for (const e of input.statusEvents) {
    if (e.created_at < from || e.created_at >= to || !e.created_by) continue
    const key = advanceOf(e, input.stageNames)
    if (!key) continue
    const mark = `${e.created_by}:${e.entity_id}:${key}`
    if (seen.has(mark)) continue
    seen.add(mark)
    row(e.created_by).advanced[key]++
  }

  // Оплата — по ответственному сейчас: он ведёт сделку, даже если этап нажал другой.
  for (const l of input.paidLeads) {
    const r = row(l.responsible_user_id)
    r.paidDeals++
    r.paidBudget += l.price ?? 0
  }

  const contactsByLead = new Map<number, number[]>()
  for (const c of input.contacts) {
    if (c.entity_type !== 'lead') continue
    const list = contactsByLead.get(c.entity_id) ?? []
    list.push(c.created_at)
    contactsByLead.set(c.entity_id, list)
  }
  const firstContact = new Map<number, number[]>()
  for (const l of input.newLeads) {
    if (l.created_at < from || l.created_at >= to) continue
    const r = row(l.responsible_user_id)
    r.leadsReceived++
    if (l.status_id === LOST) r.lostOfReceived++
    if (!isWorkingDaytime(l.created_at)) continue
    r.leadsDaytime++
    const first = (contactsByLead.get(l.id) ?? []).filter(t => t >= l.created_at).sort((a, b) => a - b)[0]
    if (first === undefined) { r.leadsNoContact++; continue }
    const list = firstContact.get(r.userId) ?? []
    list.push(Math.round((first - l.created_at) / 60))
    firstContact.set(r.userId, list)
  }
  for (const [userId, list] of firstContact) row(userId).firstContactMedianMin = median(list)

  for (const t of input.openTasks) {
    if (!t.responsible_user_id) continue
    const r = row(t.responsible_user_id)
    r.tasksOpen++
    if (t.complete_till < now) {
      r.tasksOverdue++
      if (now - t.complete_till > 30 * DAY) r.tasksOverdue30++
    }
  }

  const managers = [...rows.values()]
    .filter(r => r.leadsReceived + r.paidDeals + r.tasksOverdue + Object.values(r.advanced).reduce((s, n) => s + n, 0) > 0)
    .sort((a, b) => b.paidBudget - a.paidBudget || b.leadsReceived - a.leadsReceived)
  return { from, to, managers }
}
