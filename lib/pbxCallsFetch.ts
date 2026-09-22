import 'server-only'
import { amoGet, amoGetAll, getDomain, getPipelines } from '@/lib/amocrm'
import { getAmoUserNames } from '@/lib/amoPeople'
import { isOnlinePbxConfigured, onlinePbxHistory } from '@/lib/onlinepbx'
import { extFromRecordLink, normalizePbxCall, summarizePbx, type PbxCall, type PbxSummary } from '@/lib/pbxCalls'
import { describeMissedClient, type AmoContactHit, type AmoLeadHit, type MissedClient, type TouchEvent } from '@/lib/missedClients'

export type PbxReport =
  | { configured: false }
  | { configured: true; rawCount: number; parsed: number; sampleKeys: string[]; summary: PbxSummary; missed: MissedClient[] }

type CallNote = {
  created_by: number
  created_at: number
  note_type: string
  params?: { link?: string; uniq?: string; phone?: string; call_status?: number | null } | null
}

async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += size) out.push(...await Promise.all(items.slice(i, i + size).map(fn)))
  return out
}

export async function fetchPbxReport(from: number, to: number): Promise<PbxReport> {
  if (!isOnlinePbxConfigured()) return { configured: false }

  const [raw, notes] = await Promise.all([
    onlinePbxHistory(from, to),
    // заметки о звонках — только GET к amo: чей внутренний номер и какие звонки amo видел
    Promise.all(['leads', 'contacts', 'companies'].map(entity => amoGetAll<CallNote>(`/${entity}/notes`, {
      'filter[note_type][]': ['call_in', 'call_out'],
      'filter[updated_at][from]': String(from - 30 * 86400),
    }, 'notes'))).then(parts => parts.flat()),
  ])

  const votes = new Map<string, Map<number, number>>()
  const uniqs = new Set<string>()
  for (const n of notes) {
    if (n.params?.uniq) uniqs.add(n.params.uniq)
    const ext = extFromRecordLink(n.params?.link)
    if (!ext || !n.created_by) continue
    const v = votes.get(ext) ?? new Map<number, number>()
    v.set(n.created_by, (v.get(n.created_by) ?? 0) + 1)
    votes.set(ext, v)
  }
  const extToUser = new Map([...votes].map(([ext, v]) => [ext, [...v].sort((a, b) => b[1] - a[1])[0][0]]))

  const calls = raw.map(normalizePbxCall).filter((c): c is PbxCall => c !== null)
  const summary = summarizePbx(calls, extToUser, uniqs, to)
  return {
    configured: true,
    rawCount: raw.length,
    parsed: calls.length,
    // Пока формат ответа АТС не сверен вживую — показываем, какие поля пришли, если ничего не разобрали
    sampleKeys: raw.length > 0 && calls.length === 0 ? Object.keys(raw[0]) : [],
    summary,
    missed: await describeMissed(summary.missedNotCalledBackList, notes, extToUser),
  }
}

// Чьи это клиенты: поиск номера в amo, его сделка и было ли касание после звонка.
// По два запроса за раз — лимит amo 7 в секунду, а экран в это время грузит и таблицу.
export async function describeMissed(list: PbxSummary['missedNotCalledBackList'], notes: CallNote[], extToUser: Map<string, number>): Promise<MissedClient[]> {
  if (list.length === 0) return []
  const [users, pipelines] = await Promise.all([getAmoUserNames(), getPipelines()])
  const names = new Map(users.map(u => [u.id, u.name]))
  const stageNames = new Map<string, string>()
  for (const p of pipelines) for (const s of p._embedded.statuses) stageNames.set(`${p.id}:${s.id}`, `${p.name} → ${s.name}`)

  type RawContact = { id: number; name: string; responsible_user_id: number; _embedded?: { leads?: { id: number }[] } }
  const contactsByPhone = await inBatches(list, 2, item =>
    amoGet<{ _embedded?: { contacts?: RawContact[] } }>('/contacts', { query: item.phone, with: 'leads' })
      .then(d => (d?._embedded?.contacts ?? []).map((c): AmoContactHit => ({
        id: c.id, name: c.name, responsible_user_id: c.responsible_user_id, leads: (c._embedded?.leads ?? []).map(l => l.id),
      }))))

  const leadIds = [...new Set(contactsByPhone.flat().flatMap(c => c.leads))]
  const chunks: number[][] = []
  for (let i = 0; i < leadIds.length; i += 200) chunks.push(leadIds.slice(i, i + 200))
  const leads = new Map((await inBatches(chunks, 2, ids =>
    amoGetAll<AmoLeadHit>('/leads', { 'filter[id][]': ids.map(String) }, 'leads'))).flat().map(l => [l.id, l]))

  const touchesByPhone = await inBatches(list.map((item, i) => ({ item, contacts: contactsByPhone[i] })), 2, async ({ item, contacts }) => {
    const byEntity = [
      ['lead', contacts.flatMap(c => c.leads)],
      ['contact', contacts.map(c => c.id)],
    ] as const
    const parts = await Promise.all(byEntity.filter(([, ids]) => ids.length > 0).map(([entity, ids]) =>
      amoGetAll<TouchEvent>('/events', {
        'filter[entity]': entity,
        'filter[entity_id][]': ids.slice(0, 10).map(String),
        'filter[type][]': ['outgoing_chat_message', 'outgoing_call'],
        'filter[created_at][from]': String(item.at),
      }, 'events')))
    return parts.flat()
  })

  const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '')
  return list.map((item, i) => describeMissedClient({
    item,
    contacts: contactsByPhone[i],
    leads,
    names,
    stageNames,
    extToUser,
    // на чей телефон шёл звонок — amo записывает пропущенный на того, кому звонило
    amoRang: notes
      .filter(n => n.note_type === 'call_in' && Number(n.params?.call_status) !== 4
        && digits(n.params?.phone).endsWith(item.phone)
        && n.created_at >= item.firstAt - 120 && n.created_at <= item.at + 120)
      .sort((a, b) => a.created_at - b.created_at)
      .map(n => n.created_by),
    touches: touchesByPhone[i],
    domain: getDomain(),
  }))
}
