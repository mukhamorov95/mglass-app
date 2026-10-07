// Реестр выданных УПД и серия номеров (supabase/migrations/20261007_upd_registry.sql, этап 7).
// Приложение продолжает серию бухгалтерской программы: номер выдаётся только после того, как
// бухгалтер задал первый номер на год. До SQL владельца таблиц нет — УПД остаётся черновиком.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { UpdBody, UpdIssued } from '@/lib/b2b/updView'

export type UpdSeries = { year: number; start_number: number; set_at: string; set_by_name: string | null }
export type UpdSeriesState = UpdSeries & { last_number: number | null; last_date: string | null; issued: number }

export const missingSchema = (e: { code?: string; message: string }) =>
  ['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205'].includes(e.code ?? '') ||
  /does not exist|schema cache|could not find/i.test(e.message)

const ISSUED_COLS = 'year, number, doc_date, snapshot, issued_at, issued_by_name'

export async function loadUpdIssued(svc: SupabaseClient, orderId: number): Promise<UpdIssued | null> {
  const { data, error } = await svc.from('upd_registry').select(ISSUED_COLS).eq('b2b_order_id', orderId).maybeSingle()
  if (error) {
    if (missingSchema(error)) return null
    throw new Error(error.message)
  }
  return (data as UpdIssued | null) ?? null
}

// Серии по годам с последним выданным номером. null — таблиц ещё нет (SQL не выполнен).
export async function loadUpdSeries(svc: SupabaseClient): Promise<UpdSeriesState[] | null> {
  const { data, error } = await svc.from('upd_series').select('year, start_number, set_at, set_by_name').order('year')
  if (error) {
    if (missingSchema(error)) return null
    throw new Error(error.message)
  }
  const out: UpdSeriesState[] = []
  for (const s of (data ?? []) as UpdSeries[]) {
    const [{ data: last, error: e1 }, { count, error: e2 }] = await Promise.all([
      svc.from('upd_registry').select('number, doc_date').eq('year', s.year).order('number', { ascending: false }).limit(1).maybeSingle(),
      svc.from('upd_registry').select('id', { count: 'exact', head: true }).eq('year', s.year),
    ])
    if (e1 || e2) throw new Error((e1 ?? e2)!.message)
    out.push({ ...s, last_number: (last?.number as number | undefined) ?? null, last_date: (last?.doc_date as string | undefined) ?? null, issued: count ?? 0 })
  }
  return out
}

export type IssueResult =
  | { ok: true; issued: UpdIssued }
  | { ok: false; code: 'pending_sql' | 'series_not_set'; year?: number }

export async function issueUpd(
  svc: SupabaseClient,
  args: { orderId: number; docDate: string; entityId: number | null; body: UpdBody; by: { id: string; name: string | null } },
): Promise<IssueResult> {
  const { orderId, docDate, entityId, body, by } = args
  const { data, error } = await svc.rpc('issue_upd', {
    p_order: orderId, p_doc_date: docDate.slice(0, 10), p_buyer_entity: entityId,
    p_buyer_name: body.buyer.name, p_buyer_inn: body.buyer.inn, p_buyer_kpp: body.buyer.kpp || null,
    p_sum_no_vat: body.totals.sumNoVat, p_vat: body.totals.vat, p_sum_inc_vat: body.totals.sumIncVat,
    p_snapshot: body, p_by: by.id, p_by_name: by.name,
  })
  if (error) {
    if (missingSchema(error)) return { ok: false, code: 'pending_sql' }
    const m = /upd_series_not_set:(\d{4})/.exec(error.message)
    if (m) return { ok: false, code: 'series_not_set', year: Number(m[1]) }
    throw new Error(error.message)
  }
  const row = (Array.isArray(data) ? data[0] : data) as (UpdIssued & Record<string, unknown>) | undefined
  if (!row) throw new Error('issue_upd не вернул строку')
  return {
    ok: true,
    issued: { year: row.year, number: row.number, doc_date: row.doc_date, snapshot: row.snapshot, issued_at: row.issued_at, issued_by_name: row.issued_by_name },
  }
}
