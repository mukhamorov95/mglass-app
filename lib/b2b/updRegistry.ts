// Сквозной номер УПД за год (supabase/migrations/20261007_upd_registry.sql). Номер выдаётся
// при первой печати/PDF у менеджера и дальше не меняется; кабинет партнёра его только читает.
// До SQL владельца таблицы нет — документ печатается с номером заказа, как раньше.

import type { SupabaseClient } from '@supabase/supabase-js'

export type UpdRegistered = { year: number; number: number; doc_date: string }

const missingSchema = (e: { code?: string; message: string }) =>
  ['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205'].includes(e.code ?? '') ||
  /does not exist|schema cache|could not find/i.test(e.message)

export async function loadUpdRegistered(svc: SupabaseClient, orderId: number): Promise<UpdRegistered | null> {
  const { data, error } = await svc.from('upd_registry').select('year, number, doc_date').eq('b2b_order_id', orderId).maybeSingle()
  if (error) {
    if (missingSchema(error)) return null
    throw new Error(error.message)
  }
  return (data as UpdRegistered | null) ?? null
}

export async function assignUpdNumber(
  svc: SupabaseClient, orderId: number, docDate: string, by: { id: string; name: string | null },
): Promise<{ registered: UpdRegistered | null; pendingSql: boolean }> {
  const { data, error } = await svc.rpc('assign_upd_number', {
    p_order: orderId, p_doc_date: docDate.slice(0, 10), p_by: by.id, p_by_name: by.name,
  })
  if (error) {
    if (missingSchema(error)) return { registered: null, pendingSql: true }
    throw new Error(error.message)
  }
  const row = (Array.isArray(data) ? data[0] : data) as UpdRegistered | undefined
  return { registered: row ?? null, pendingSql: false }
}
