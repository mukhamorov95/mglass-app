import { readFileSync } from 'node:fs'
import { createServiceClient } from '../supabase-service'
import { referenceErrors, type Reference } from '../economics/engine/reference'
import type { LabProject } from '../economics/lab/project'
import type { LabQuote } from '../economics/lab/quote'

// Доступ к данным лаборатории. Сервис-ключ: у таблиц RLS без политик, читает и пишет только
// сервер после проверки роли в маршруте. Справочники лежат в базе, потому что репозиторий
// публичный, а в них закупочные цены и ставки, выведенные из окладов.
// Локальные файлы — путь разработки: на проде их нет, и это сказано вслух, а не подменено нулём.
const LOCAL = {
  tech: 'docs/economics/reference/tech.v2.json',
  finance: 'docs/economics/private/finance.v1.json',
} as const

export type RefLoad = {
  tech: Reference | null
  finance: Reference | null
  source: { tech: string | null; finance: string | null }
  problems: string[]
}

const localRef = (id: 'tech' | 'finance'): Reference | null => {
  if (process.env.NODE_ENV === 'production') return null
  try { return JSON.parse(readFileSync(LOCAL[id], 'utf8')) as Reference } catch { return null }
}

export async function loadReferences(): Promise<RefLoad> {
  const out: RefLoad = { tech: null, finance: null, source: { tech: null, finance: null }, problems: [] }
  const sb = createServiceClient()
  const { data, error } = await sb.from('economics_lab_reference').select('id, version, data, updated_at')
  if (error) out.problems.push(`справочник из базы не прочитался: ${error.message}`)
  for (const id of ['tech', 'finance'] as const) {
    const row = (data ?? []).find(r => r.id === id)
    if (row?.data) {
      out[id] = row.data as Reference
      out.source[id] = `база, версия ${row.version}, обновлён ${String(row.updated_at).slice(0, 10)}`
    } else {
      const local = localRef(id)
      if (local) { out[id] = local; out.source[id] = `локальный файл ${LOCAL[id]} (путь разработки)` }
      else out.problems.push(`${id === 'tech' ? 'технический' : 'финансовый'} справочник не загружен`)
    }
    const ref = out[id]
    if (ref) {
      const errs = referenceErrors(ref)
      if (errs.length) { out.problems.push(...errs.slice(0, 5).map(e => `${id}: ${e}`)); out[id] = null }
    }
  }
  return out
}

// Запись справочника: прежняя версия уходит в историю, новая получает номер +1.
export async function saveReference(id: 'tech' | 'finance', ref: Reference, reason: string, actor: string | null) {
  const errs = referenceErrors(ref)
  if (errs.length) throw new Error(errs.join('; '))
  const sb = createServiceClient({ actor })
  const { data: prev } = await sb.from('economics_lab_reference').select('version, data').eq('id', id).maybeSingle()
  if (prev) {
    await sb.from('economics_lab_reference_history')
      .upsert({ ref_id: id, version: prev.version, data: prev.data, reason, saved_by: actor }, { onConflict: 'ref_id,version' })
  }
  const { error } = await sb.from('economics_lab_reference')
    .upsert({ id, version: ref.version, data: ref, updated_at: new Date().toISOString(), updated_by: actor })
  if (error) throw new Error(error.message)
}

export type ProjectRow = { id: string; title: string; note: string; input: LabProject; created_at: string; updated_at: string; variants?: number }

export async function listProjects(): Promise<{ rows: ProjectRow[]; error: string | null }> {
  const sb = createServiceClient()
  const { data, error } = await sb.from('economics_lab_projects')
    .select('id, title, note, input, created_at, updated_at, economics_lab_variants(count)')
    .order('updated_at', { ascending: false }).limit(200)
  if (error) return { rows: [], error: error.message }
  const rows = (data ?? []).map(r => ({
    id: String(r.id), title: String(r.title), note: String(r.note ?? ''),
    input: r.input as LabProject, created_at: String(r.created_at), updated_at: String(r.updated_at),
    variants: Number((r.economics_lab_variants as { count: number }[] | null)?.[0]?.count ?? 0),
  }))
  return { rows, error: null }
}

export async function getProject(id: string): Promise<ProjectRow | null> {
  const sb = createServiceClient()
  const { data } = await sb.from('economics_lab_projects').select('id, title, note, input, created_at, updated_at').eq('id', id).maybeSingle()
  if (!data) return null
  return {
    id: String(data.id), title: String(data.title), note: String(data.note ?? ''),
    input: data.input as LabProject, created_at: String(data.created_at), updated_at: String(data.updated_at),
  }
}

export async function upsertProject(p: LabProject, actor: string | null): Promise<{ id: string } | { error: string }> {
  const sb = createServiceClient({ actor })
  const row = { title: p.title, note: p.note, input: { ...p, id: undefined }, updated_at: new Date().toISOString() }
  if (p.id) {
    const { error } = await sb.from('economics_lab_projects').update(row).eq('id', p.id)
    return error ? { error: error.message } : { id: p.id }
  }
  const { data, error } = await sb.from('economics_lab_projects').insert({ ...row, created_by: actor }).select('id').single()
  return error ? { error: error.message } : { id: String(data!.id) }
}

export async function deleteProject(id: string) {
  const sb = createServiceClient()
  const { error } = await sb.from('economics_lab_projects').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export type VariantRow = {
  id: string; label: string; note: string; tech_stamp: string; finance_stamp: string | null
  computed_at: string; input: LabProject; result: LabQuote
}

export async function saveVariant(projectId: string, label: string, note: string, project: LabProject, quote: LabQuote, actor: string | null) {
  const sb = createServiceClient({ actor })
  const { data, error } = await sb.from('economics_lab_variants').insert({
    project_id: projectId, label, note,
    tech_stamp: quote.stamps.tech, finance_stamp: quote.stamps.finance,
    input: project, result: quote, computed_at: quote.computedAt, saved_by: actor,
  }).select('id').single()
  if (error) throw new Error(error.message)
  return String(data!.id)
}

export async function listVariants(projectId: string): Promise<VariantRow[]> {
  const sb = createServiceClient()
  const { data } = await sb.from('economics_lab_variants')
    .select('id, label, note, tech_stamp, finance_stamp, computed_at, input, result')
    .eq('project_id', projectId).order('computed_at', { ascending: false }).limit(50)
  return (data ?? []).map(r => ({
    id: String(r.id), label: String(r.label), note: String(r.note ?? ''),
    tech_stamp: String(r.tech_stamp), finance_stamp: r.finance_stamp ? String(r.finance_stamp) : null,
    computed_at: String(r.computed_at), input: r.input as LabProject, result: r.result as LabQuote,
  }))
}

export async function deleteVariant(id: string) {
  const sb = createServiceClient()
  const { error } = await sb.from('economics_lab_variants').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
