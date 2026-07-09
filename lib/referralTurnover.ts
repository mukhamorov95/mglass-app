import type { SupabaseClient } from '@supabase/supabase-js'

// Партнёрка: авто-оборот по клиентам, привязанным к CRM (b2b_client_id) —
// помесячные суммы из b2b_orders с 2026 года. Для непривязанных клиентов
// действует ручной ввод (referral_turnover). Серверный код (service client).

export type RefClient = { id: number; referrer_id: string; name: string; note: string | null; b2b_client_id: number | null }
export type MonthAmount = { ym: string; amount: number }

export async function buildAutoTurnover(
  sb: SupabaseClient,
  clients: RefClient[],
): Promise<Record<number, MonthAmount[]>> {
  const linked = clients.filter(c => c.b2b_client_id != null)
  if (!linked.length) return {}
  const b2bIds = [...new Set(linked.map(c => c.b2b_client_id!))]
  const { data: orders } = await sb.from('b2b_orders')
    .select('client_id,total_after_discount,total_sale_inc_vat,created_at')
    .in('client_id', b2bIds)
    .gte('created_at', '2026-01-01')
    .limit(20000)

  const byClientMonth = new Map<number, Map<string, number>>()
  for (const o of orders ?? []) {
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
