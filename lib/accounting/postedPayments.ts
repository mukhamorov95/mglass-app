import type { SupabaseClient } from '@supabase/supabase-js'
import { readPaged, num } from '@/lib/money/paged'

// Какие платежи уже проведены в ДДС (cashflow_entries.payment_id) или пропущены
// бухгалтером. Обе таблицы растут без конца: читаем постранично, иначе после 1000-й
// операции проведённые платежи снова всплывали бы «к проведению».

export async function loadPostedPaymentIds(svc: SupabaseClient): Promise<Set<number>> {
  const rows = await readPaged(() => svc.from('cashflow_entries')
    .select('id, payment_id').not('payment_id', 'is', null).order('id'))
  return new Set(rows.map(r => num(r.payment_id)))
}

export async function loadPaymentSkips(svc: SupabaseClient): Promise<Map<number, string | null>> {
  const rows = await readPaged(() => svc.from('cashflow_payment_skips')
    .select('payment_id, reason').order('payment_id'))
  return new Map(rows.map(r => [num(r.payment_id), (r.reason as string | null) ?? null]))
}
