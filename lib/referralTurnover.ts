import type { SupabaseClient } from '@supabase/supabase-js'

// Партнёрка: авто-оборот по клиентам, привязанным к CRM (b2b_client_id) —
// помесячные суммы из b2b_orders с 2026 года. Для непривязанных клиентов
// действует ручной ввод (referral_turnover). Серверный код (service client).

export type RefClient = { id: number; referrer_id: string; name: string; note: string | null; b2b_client_id: number | null }
export type MonthAmount = { ym: string; amount: number }

// Считается ли заказ в оборот партнёра.
//
// Архив в этой системе — уборка, а не отмена: 30.06.2026 одним действием туда ушли
// 398 заказов клиентов Адилета, и 352 из них ОТГРУЖЕНЫ. Фильтр «архивные не берём»
// вычёркивал их вместе с настоящей работой: кабинет показывал 200 заказов и 5,4 млн
// вместо 565 и 15,1 млн — почти 97 тысяч его начисления пропадали.
//
// Правило: заказ, который стал работой (запущен в цех или отгружен), считается
// независимо от архива. Архивный и при этом никогда не запускавшийся — не считается:
// это и есть удалённая ошибка.
export function countsForReferral(o: { archived_at?: string | null; notes?: unknown }): boolean {
  if (!o.archived_at) return true
  const n = parseNotes(o.notes)
  const stages = (n.stages ?? {}) as Record<string, unknown>
  return !!n.launched_at || !!stages.shipped
}

function parseNotes(n: unknown): Record<string, unknown> {
  if (!n) return {}
  if (typeof n === 'object') return n as Record<string, unknown>
  try { return JSON.parse(String(n)) as Record<string, unknown> } catch { return {} }
}

export async function buildAutoTurnover(
  sb: SupabaseClient,
  clients: RefClient[],
): Promise<Record<number, MonthAmount[]>> {
  const linked = clients.filter(c => c.b2b_client_id != null)
  if (!linked.length) return {}
  const b2bIds = [...new Set(linked.map(c => c.b2b_client_id!))]
  // Без просчётов (quote) и без импортированной истории (historical): иначе оборот
  // партнёрки раздувается тем, что заказом так и не стало.
  // Архив НЕ фильтруем здесь — решает countsForReferral, см. комментарий у неё.
  const { data: orders } = await sb.from('b2b_orders')
    .select('client_id,total_after_discount,total_sale_inc_vat,created_at,archived_at,notes')
    .in('client_id', b2bIds)
    .gte('created_at', '2026-01-01')
    .not('notes', 'ilike', '%"status":"quote"%')
    .not('notes', 'ilike', '%"historical":true%')
    .limit(20000)

  const byClientMonth = new Map<number, Map<string, number>>()
  for (const o of orders ?? []) {
    if (!countsForReferral(o)) continue
    const amt = Number(o.total_after_discount ?? o.total_sale_inc_vat ?? 0)
    if (!amt) continue
    const ym = `${String(o.created_at).slice(0, 7)}-01`
    const m = byClientMonth.get(o.client_id) ?? new Map<string, number>()
    m.set(ym, (m.get(ym) ?? 0) + amt)
    byClientMonth.set(o.client_id, m)
  }
  const out: Record<number, MonthAmount[]> = {}
  for (const c of linked) {
    const m = byClientMonth.get(c.b2b_client_id!)
    if (m) out[c.id] = [...m.entries()].map(([ym, amount]) => ({ ym, amount })).sort((a, b) => a.ym.localeCompare(b.ym))
  }
  return out
}

// Итоговый оборот клиента: авто (если привязан) иначе ручной.
export function mergeTurnover(
  clients: RefClient[],
  manual: { referral_client_id: number; ym: string; amount: number }[],
  auto: Record<number, MonthAmount[]>,
): { referral_client_id: number; ym: string; amount: number; source: 'auto' | 'manual' }[] {
  const rows: { referral_client_id: number; ym: string; amount: number; source: 'auto' | 'manual' }[] = []
  for (const c of clients) {
    if (c.b2b_client_id != null) {
      for (const t of auto[c.id] ?? []) rows.push({ referral_client_id: c.id, ym: t.ym, amount: t.amount, source: 'auto' })
    } else {
      for (const t of manual.filter(m => m.referral_client_id === c.id))
        rows.push({ referral_client_id: c.id, ym: t.ym, amount: Number(t.amount), source: 'manual' })
    }
  }
  return rows
}
