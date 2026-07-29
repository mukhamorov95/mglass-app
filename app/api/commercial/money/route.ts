import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'
import { launchedOrders, orderAmount } from '@/lib/liveOrders'

// Продажи по менеджеру за текущий месяц: выручка + маржа + сделки + средний чек.
// Объединяет B2B (b2b_orders, владелец в notes.manager_name) и B2C (calculations,
// created_by → users.name). Read-only. РОП (commercial) и владелец видят команду.
//
// Выручка B2B = ЗАПУЩЕННЫЕ в работу не архивные заказы (launchedOrders), а не
// notes.status. Словарь статусов уехал: рабочий статус июльских заказов — 'sent',
// а агрегат искал 'confirmed'/'agreed' и находил 3 архивные строки на 68 073 ₽
// вместо 161 заказа на 3 704 807 ₽. На этом лидерборде висит мотивация менеджеров.

type ManagerRow = {
  name: string
  revenue: number
  deals: number
  avgCheck: number
  avgMargin: number
  b2bRevenue: number
  b2cRevenue: number
}

function parseNotes(notes: string | null): Record<string, unknown> {
  if (!notes) return {}
  try { const p = JSON.parse(notes); if (typeof p === 'object' && p !== null) return p as Record<string, unknown> } catch {}
  return {}
}

function monthStartISO(): string {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
}

export async function GET() {
  const guard = await requireRole(['admin', 'ceo', 'commercial', 'cfo'])
  if (guard instanceof NextResponse) return guard
  const sb = createServiceClient()
  const since = monthStartISO()

  const [{ data: users }, { data: b2b }, { data: calcs }] = await Promise.all([
    sb.from('users').select('id,name'),
    launchedOrders(sb, 'total_after_discount,total_sale_inc_vat,margin_percent,notes,created_at')
      .gte('created_at', since),
    sb.from('calculations')
      .select('created_by,final_price,margin,created_at,status')
      .eq('status', 'approved').gte('created_at', since).limit(5000),
  ])

  const nameById = new Map<string, string>()
  for (const u of (users ?? []) as { id: string; name: string | null }[]) nameById.set(u.id, u.name ?? '—')

  type Agg = { name: string; revenue: number; deals: number; margins: number[]; b2bRevenue: number; b2cRevenue: number }
  const map = new Map<string, Agg>()
  const bump = (name: string): Agg => {
    if (!map.has(name)) map.set(name, { name, revenue: 0, deals: 0, margins: [], b2bRevenue: 0, b2cRevenue: 0 })
    return map.get(name)!
  }

  // B2B — заказы, запущенные в работу за месяц
  for (const o of (b2b ?? []) as Record<string, unknown>[]) {
    const notes = parseNotes(o.notes as string | null)
    const name = (notes.manager_name as string) || 'Без менеджера'
    const price = orderAmount(o as { total_after_discount?: number | null; total_sale_inc_vat?: number | null })
    const row = bump(name)
    row.deals++; row.revenue += price; row.b2bRevenue += price
    const m = Number(o.margin_percent)
    if (Number.isFinite(m) && m > 0) row.margins.push(m)
  }

  // B2C — одобренные просчёты
  for (const c of (calcs ?? []) as Record<string, unknown>[]) {
    const name = nameById.get(String(c.created_by)) || 'Без менеджера'
    const price = Number(c.final_price) || 0
    const row = bump(name)
    row.deals++; row.revenue += price; row.b2cRevenue += price
    const m = Number(c.margin)
    if (Number.isFinite(m) && m > 0) row.margins.push(m)
  }

  const managers: ManagerRow[] = [...map.values()]
    .map(r => ({
      name: r.name,
      revenue: Math.round(r.revenue),
      deals: r.deals,
      avgCheck: r.deals > 0 ? Math.round(r.revenue / r.deals) : 0,
      avgMargin: r.margins.length ? Math.round(r.margins.reduce((a, b) => a + b, 0) / r.margins.length) : 0,
      b2bRevenue: Math.round(r.b2bRevenue),
      b2cRevenue: Math.round(r.b2cRevenue),
    }))
    .sort((a, b) => b.revenue - a.revenue)

  const marginMgrs = managers.filter(m => m.avgMargin > 0)
  const revenue = managers.reduce((s, m) => s + m.revenue, 0)
  const deals   = managers.reduce((s, m) => s + m.deals, 0)
  const totals = {
    revenue,
    deals,
    avgCheck:  deals > 0 ? Math.round(revenue / deals) : 0,
    avgMargin: marginMgrs.length ? Math.round(marginMgrs.reduce((s, m) => s + m.avgMargin, 0) / marginMgrs.length) : 0,
  }

  return NextResponse.json({ month: since.slice(0, 7), managers, totals })
}
