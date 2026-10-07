import type { SupabaseClient } from '@supabase/supabase-js'
import { mskDayKey } from '@/lib/time'
import { loadUpdSeries } from '@/lib/b2b/updRegistry'
import { updQueue, type QueueOrder, type UpdQueue } from '@/lib/b2b/updQueue'
import { readPaged, num } from '@/lib/money/paged'

// «Ждут УПД» — одна сборка для «Бухгалтерия → УПД» и стартовой вкладки «Ждут действия».
// Заказы, выданные УПД и клиенты с ИНН — постранично (потолок PostgREST 1000 строк).

export async function loadUpdQueue(svc: SupabaseClient, switchDay: string, year: number): Promise<UpdQueue & { switchDay: string }> {
  const since = new Date(Date.parse(`${switchDay}T00:00:00Z`) - 180 * 86400e3).toISOString()
  const [orders, issued, clients, entities] = await Promise.all([
    readPaged(() => svc.from('b2b_orders')
      .select('id, custom_number, client_id, client_name, notes, created_at, launched_at, total_after_discount, total_sale_inc_vat')
      .is('archived_at', null).not('launched_at', 'is', null).gte('created_at', since).order('id')),
    readPaged(() => svc.from('upd_registry').select('id, b2b_order_id').gte('year', year - 1).order('id')),
    readPaged(() => svc.from('b2b_clients').select('id').neq('inn', '').order('id')),
    readPaged(() => svc.from('b2b_client_legal_entities').select('id, client_id').eq('active', true).neq('inn', '').order('id')),
  ])
  const issuedIds = new Set(issued.map(r => num(r.b2b_order_id)))
  const innClients = new Set([...clients.map(r => num(r.id)), ...entities.map(r => num(r.client_id))])
  return { switchDay, ...updQueue(orders as unknown as QueueOrder[], issuedIds, innClients, switchDay) }
}

export type UpdWaiting =
  | { state: 'pending_sql' }
  | { state: 'no_series'; year: number }
  | { state: 'ok'; count: number; noInn: number; undated: number; sum: number }

// Сколько отгружено без УПД сейчас: серия текущего года задаёт день переключения на приложение.
export async function loadUpdWaiting(svc: SupabaseClient, today = mskDayKey()): Promise<UpdWaiting> {
  const series = await loadUpdSeries(svc)
  if (series === null) return { state: 'pending_sql' }
  const year = Number(today.slice(0, 4))
  const cur = series.find(s => s.year === year)
  if (!cur) return { state: 'no_series', year }
  const q = await loadUpdQueue(svc, mskDayKey(cur.set_at), year)
  return { state: 'ok', count: q.rows.length, noInn: q.noInn, undated: q.undated, sum: q.rows.reduce((s, r) => s + r.total, 0) }
}
