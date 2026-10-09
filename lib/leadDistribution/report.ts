import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { amoGetAll } from '@/lib/amocrm'
import { getAmoUserNames } from '@/lib/amoPeople'
import { median } from '@/lib/amoActivity'
import { escapeHtml } from '@/lib/security/accessAudit'
import { OUTGOING_REASON } from '@/lib/leadDistribution/rules'

// Вечерний блок тени для владельца: кому отдал бы алгоритм против того, у кого заявка сейчас,
// и сколько ждала ручного назначения. Только GET к amo; журнал — lead_distribution.

type Row = { lead_id: number; lead_created_at: string; status: string; chosen_user_id: number | null; chosen_name: string | null; decided_at: string | null; reason: string | null; rule: string | null }
type Ev = { entity_id: number; entity_type: string; created_at: number }

const unix = (s: string) => Math.floor(Date.parse(s) / 1000)
const chunks = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))
const tally = (xs: string[]) => [...xs.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>())]
  .sort((a, b) => b[1] - a[1]).map(([k, v]) => `${escapeHtml(k)} ${v}`).join(' · ')

export async function distributionSummary(sb: SupabaseClient, from: number, now: number): Promise<string> {
  const { data, error } = await sb.from('lead_distribution')
    .select('lead_id, lead_created_at, status, chosen_user_id, chosen_name, decided_at, reason, rule')
    .gte('lead_created_at', new Date(from * 1000).toISOString()).lt('lead_created_at', new Date(now * 1000).toISOString())
  if (error) throw new Error(`Не прочитать журнал распределения: ${error.message}`)
  const all = (data ?? []) as Row[]
  const outgoing = all.filter(r => r.status === 'skipped' && r.reason === OUTGOING_REASON).length
  const rows = all.filter(r => !(r.status === 'skipped' && r.reason === OUTGOING_REASON))
  const decided = rows.filter(r => r.status === 'decided' && r.chosen_user_id)
  const lines = [`🧭 <b>Распределение — тень</b>: заявок ${rows.length}, в amo ничего не менялось`]
  if (outgoing) lines.push(`Исходящих звонков менеджеров (сделки АТС, не заявки): ${outgoing}`)
  if (decided.length === 0) return [...lines, rows.length ? `Ждут начала смены: ${rows.filter(r => r.status === 'deferred').length}` : ''].filter(Boolean).join('\n')

  const names = new Map((await getAmoUserNames()).map(u => [u.id, u.name]))
  const ids = decided.map(r => String(r.lead_id))
  const current = new Map<number, number>()
  for (const part of chunks(ids, 200)) {
    for (const l of await amoGetAll<{ id: number; responsible_user_id: number }>('/leads', { 'filter[id][]': part }, 'leads')) current.set(l.id, l.responsible_user_id)
  }
  const changes = await amoGetAll<Ev>('/events', {
    'filter[type][]': ['entity_responsible_changed'], 'filter[created_at][from]': String(from),
  }, 'events')
  const firstChange = new Map<number, number>()
  for (const e of changes) if (e.entity_type === 'lead') firstChange.set(e.entity_id, Math.min(firstChange.get(e.entity_id) ?? Infinity, e.created_at))

  const same = decided.filter(r => current.get(Number(r.lead_id)) === Number(r.chosen_user_id)).length
  const manualMin = decided.filter(r => firstChange.has(Number(r.lead_id)))
    .map(r => Math.round((firstChange.get(Number(r.lead_id))! - unix(r.lead_created_at)) / 60))
  const algoMin = decided.map(r => Math.round((unix(r.decided_at!) - unix(r.lead_created_at)) / 60))
  const skipped = decided.flatMap(r => (r.reason ?? '').split('; ').filter(x => x.startsWith('пропущен(а): ')).map(x => x.slice(13).split(' — ')[0]))

  lines.push(
    `Алгоритм отдал бы: ${tally(decided.map(r => r.chosen_name ?? '—'))}`,
    `Сейчас в amo: ${tally(decided.map(r => names.get(current.get(Number(r.lead_id)) ?? 0) ?? 'нет ответственного'))}`,
    `Совпало: ${same} из ${decided.length}`,
    `Назначили вручную: ${manualMin.length} из ${decided.length}, медиана ${median(manualMin) ?? '—'} мин · алгоритм — медиана ${median(algoMin) ?? '—'} мин`,
  )
  const known = decided.filter(r => r.rule === 'known_client').length
  if (known) lines.push(`Знакомым клиентам — своему менеджеру: ${known}`)
  if (skipped.length) lines.push(`Пропускал из-за загрузки: ${tally(skipped)}`)
  if (decided.some(r => r.rule === 'least_loaded')) lines.push(`⚠️ Были моменты, когда перегружены все на смене: ${decided.filter(r => r.rule === 'least_loaded').length}`)
  const waiting = rows.filter(r => r.status === 'deferred').length
  if (waiting) lines.push(`Ждут начала смены: ${waiting}`)
  return lines.join('\n')
}
