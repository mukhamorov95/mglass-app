import 'server-only'
import { amoGetAll } from '@/lib/amocrm'
import { isOnlinePbxConfigured, onlinePbxHistory } from '@/lib/onlinepbx'
import { extFromRecordLink, normalizePbxCall, summarizePbx, type PbxCall, type PbxSummary } from '@/lib/pbxCalls'

export type PbxReport =
  | { configured: false }
  | { configured: true; rawCount: number; parsed: number; sampleKeys: string[]; summary: PbxSummary }

type CallNote = { created_by: number; params?: { link?: string; uniq?: string } | null }

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
  return {
    configured: true,
    rawCount: raw.length,
    parsed: calls.length,
    // Пока формат ответа АТС не сверен вживую — показываем, какие поля пришли, если ничего не разобрали
    sampleKeys: raw.length > 0 && calls.length === 0 ? Object.keys(raw[0]) : [],
    summary: summarizePbx(calls, extToUser, uniqs, to),
  }
}
