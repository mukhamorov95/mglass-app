import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

// Поступления по менеджерам за период — из deal_payments (розничные оплаты сделок).
// Зарабатывающий менеджер = deals.manager_id (иначе created_by). По дате ПОСТУПЛЕНИЯ
// (paid_at), не записи. Основа зарплатной таблицы. Read-only, команда — владельцу/РОП.

const ymd = (d: Date) => d.toISOString().slice(0, 10)

export async function GET(req: NextRequest) {
  const guard = await requireRole(['admin', 'ceo', 'commercial', 'cfo'])
  if (guard instanceof NextResponse) return guard
  const sb = createServiceClient()

  const now = new Date()
  const qFrom = req.nextUrl.searchParams.get('from')
  const qTo = req.nextUrl.searchParams.get('to')
  const from = qFrom || ymd(new Date(now.getFullYear(), now.getMonth(), 1))
  // to — исключительная граница (следующий день/месяц). По умолчанию начало след. месяца.
  const to = qTo || ymd(new Date(now.getFullYear(), now.getMonth() + 1, 1))

  const { data: pays } = await sb.from('deal_payments')
    .select('deal_id, kind, amount, paid_at')
    .gte('paid_at', from).lt('paid_at', to).limit(20000)
  const rows = (pays ?? []) as { deal_id: number; kind: string; amount: number; paid_at: string }[]

  const dealIds = [...new Set(rows.map(r => r.deal_id))]
  const dealMgr = new Map<number, string | null>()
  if (dealIds.length) {
    const { data: deals } = await sb.from('deals').select('id, manager_id, created_by').in('id', dealIds)
    for (const d of (deals ?? []) as { id: number; manager_id: string | null; created_by: string | null }[]) {
      dealMgr.set(d.id, d.manager_id ?? d.created_by)
    }
  }
  const { data: users } = await sb.from('users').select('id, name')
  const nameById = new Map<string, string>()
  for (const u of (users ?? []) as { id: string; name: string | null }[]) nameById.set(u.id, u.name ?? '—')

  type Agg = { manager_id: string; name: string; total: number; prepay: number; balance: number; install: number; count: number }
  const map = new Map<string, Agg>()
  for (const r of rows) {
    const mgr = dealMgr.get(r.deal_id) ?? 'unknown'
    if (!map.has(mgr)) map.set(mgr, { manager_id: mgr, name: nameById.get(mgr) ?? 'Без менеджера', total: 0, prepay: 0, balance: 0, install: 0, count: 0 })
    const a = map.get(mgr)!
    const amt = Number(r.amount) || 0
    a.total += amt; a.count += 1
    if (r.kind === 'prepay') a.prepay += amt
    else if (r.kind === 'balance') a.balance += amt
    else if (r.kind === 'install') a.install += amt
  }
  const managers = [...map.values()].sort((a, b) => b.total - a.total)
  const totals = managers.reduce((s, m) => ({
    total: s.total + m.total, prepay: s.prepay + m.prepay, balance: s.balance + m.balance, install: s.install + m.install, count: s.count + m.count,
  }), { total: 0, prepay: 0, balance: 0, install: 0, count: 0 })

  return NextResponse.json({ from, to, managers, totals }, { headers: { 'Cache-Control': 'no-store' } })
}
