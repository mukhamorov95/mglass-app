// День менеджера одной строкой: amo (действия, сообщения, звонки, этапы), АТС и
// документы приложения. Чистая функция — сборка данных в lib/managerDayFetch.ts.
//
// Звонки и сообщения не пересчитываются заново: берутся из buildAmoActivity, иначе
// «вчера» на «Утре» и на /commercial/activity разойдутся.

import { median, type AmoActivityReport } from '@/lib/amoActivity'
import type { AmoResultsReport } from '@/lib/amoResults'
import type { PbxSummary } from '@/lib/pbxCalls'

export type AppDocs = { quick: number; calcs: number; kp: number; contracts: number }

export type ManagerDayRow = {
  day: string
  amo_user_id: number
  name: string
  first_at: string | null
  last_at: string | null
  active_hours: number | null
  longest_pause_min: number | null
  actions: number
  messages_own: number
  messages_no_author: number
  client_messages: number
  reply_median_min: number | null
  replies_counted: number
  unanswered: number
  left_waiting: number
  tasks_completed: number
  tasks_postponed: number
  cards_moved: number
  calls_out: number
  calls_out_ok: number
  calls_in: number
  calls_in_missed: number
  talk_sec: number
  leads_received: number | null
  first_contact_median_min: number | null
  adv_measure: number | null
  adv_kp: number | null
  adv_invoice: number | null
  adv_paid: number | null
  pbx_out: number | null
  pbx_out_ok: number | null
  pbx_in: number | null
  pbx_talk_sec: number | null
  app_quick: number
  app_calcs: number
  app_kp: number
  app_contracts: number
}

const iso = (ts: number | null) => (ts == null ? null : new Date(ts * 1000).toISOString())

export function buildDayRows(input: {
  day: string
  activity: AmoActivityReport
  results: AmoResultsReport | null
  pbx: PbxSummary['byUser'] | null
  docs: Map<number, AppDocs>
  names: Map<number, string>
}): ManagerDayRow[] {
  const { day, activity, results, pbx, docs, names } = input
  const act = new Map(activity.managers.map(m => [m.userId, m]))
  const res = new Map((results?.managers ?? []).map(m => [m.userId, m]))
  // Один человек может сидеть на двух внутренних номерах — складываем.
  const calls = new Map<number, { out: number; ok: number; in: number; talk: number }>()
  for (const u of pbx ?? []) {
    if (u.userId == null) continue
    const c = calls.get(u.userId) ?? { out: 0, ok: 0, in: 0, talk: 0 }
    c.out += u.outbound; c.ok += u.outboundAnswered; c.in += u.inboundAnswered; c.talk += u.talkSec
    calls.set(u.userId, c)
  }

  const ids = new Set<number>([...act.keys(), ...res.keys(), ...calls.keys(), ...docs.keys()])
  const rows: ManagerDayRow[] = []
  for (const id of ids) {
    const a = act.get(id)
    const d = a?.days.find(x => x.day === day)
    const r = res.get(id)
    const c = calls.get(id)
    const doc = docs.get(id) ?? { quick: 0, calcs: 0, kp: 0, contracts: 0 }
    rows.push({
      day,
      amo_user_id: id,
      name: names.get(id) ?? a?.name ?? r?.name ?? `amo #${id}`,
      first_at: iso(d?.firstAt ?? null),
      last_at: iso(d?.lastAt ?? null),
      active_hours: d ? d.activeHours : null,
      longest_pause_min: d ? d.longestPauseMin : null,
      actions: d?.actions ?? 0,
      messages_own: d?.messagesOwn ?? 0,
      messages_no_author: d?.messagesNoAuthor ?? 0,
      client_messages: d?.clientMessages ?? 0,
      reply_median_min: d ? median(d.replyMinutes) : null,
      replies_counted: d?.replyMinutes.length ?? 0,
      unanswered: d?.unanswered ?? 0,
      left_waiting: d?.leftWaiting ?? 0,
      tasks_completed: d?.tasksCompleted ?? 0,
      tasks_postponed: d?.tasksPostponed ?? 0,
      cards_moved: d?.cardsMoved ?? 0,
      calls_out: d?.callsOut ?? 0,
      calls_out_ok: d?.callsOutConnected ?? 0,
      calls_in: d?.callsInAnswered ?? 0,
      calls_in_missed: d?.callsInMissed ?? 0,
      talk_sec: d?.talkSeconds ?? 0,
      leads_received: results ? (r?.leadsReceived ?? 0) : null,
      first_contact_median_min: r?.firstContactMedianMin ?? null,
      adv_measure: results ? (r?.advanced.measure ?? 0) : null,
      adv_kp: results ? (r?.advanced.kp ?? 0) : null,
      adv_invoice: results ? (r?.advanced.invoice ?? 0) : null,
      adv_paid: results ? (r?.advanced.paid ?? 0) : null,
      pbx_out: pbx ? (c?.out ?? 0) : null,
      pbx_out_ok: pbx ? (c?.ok ?? 0) : null,
      pbx_in: pbx ? (c?.in ?? 0) : null,
      pbx_talk_sec: pbx ? (c?.talk ?? 0) : null,
      app_quick: doc.quick,
      app_calcs: doc.calcs,
      app_kp: doc.kp,
      app_contracts: doc.contracts,
    })
  }
  return rows.sort((x, y) => y.actions - x.actions || x.name.localeCompare(y.name, 'ru'))
}

// Документы приложения по учётке: uuid автора → amo-id через users.amo_user_id.
export function countAppDocs(input: {
  users: { id: string; amo_user_id: number | null }[]
  calcs: { created_by: string | null; product_type: string | null }[]
  kp: { manager_id: string | null }[]
  contracts: { manager_id: string | null }[]
}): Map<number, AppDocs> {
  const amo = new Map(input.users.filter(u => u.amo_user_id != null).map(u => [u.id, Number(u.amo_user_id)]))
  const out = new Map<number, AppDocs>()
  const bump = (uid: string | null, key: keyof AppDocs) => {
    const id = uid ? amo.get(uid) : undefined
    if (id == null) return
    const d = out.get(id) ?? { quick: 0, calcs: 0, kp: 0, contracts: 0 }
    d[key]++
    out.set(id, d)
  }
  for (const c of input.calcs) { bump(c.created_by, 'calcs'); if (c.product_type === 'quick') bump(c.created_by, 'quick') }
  for (const k of input.kp) bump(k.manager_id, 'kp')
  for (const c of input.contracts) bump(c.manager_id, 'contracts')
  return out
}
