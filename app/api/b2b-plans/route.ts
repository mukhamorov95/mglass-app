import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { isOwnerRole } from '@/lib/getRole'
import { finalTotalOf } from '@/lib/b2b/priceOverride'

// А18: план/факт менеджера по B2B за месяц.
// План — из b2b_manager_plans (ставит владелец/коммерческий).
// Факт считается из b2b_orders на лету: запущено за месяц и оплачено за месяц.
// Прогноз — линейная экстраполяция по прошедшим дням, честно помечен как оценка.

const ALLOWED = ['admin', 'ceo', 'manager', 'commercial', 'cfo'] as const

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

function parseNotes(n: unknown): Record<string, unknown> {
  if (!n) return {}
  try { const p = JSON.parse(String(n)); return p && typeof p === 'object' ? p as Record<string, unknown> : {} } catch { return {} }
}

export async function GET(req: NextRequest) {
  const guard = await requireRole([...ALLOWED])
  if (guard instanceof NextResponse) return guard
  const role = guard as string

  const sb = await createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const month = req.nextUrl.searchParams.get('month') ?? monthKey(new Date())
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: 'Плохой месяц' }, { status: 400 })

  const seeAll = isOwnerRole(role) || role === 'commercial' || role === 'cfo'
  const from = new Date(`${month}-01T00:00:00.000Z`)
  const to = new Date(from); to.setMonth(to.getMonth() + 1)

  const [{ data: plans }, { data: orders }] = await Promise.all([
    sb.from('b2b_manager_plans').select('manager_id, plan_amount, note').eq('month', month),
    sb.from('b2b_orders')
      .select('id, created_by, created_by_name, launched_at, total_after_discount, total_sale_inc_vat, notes')
      .is('archived_at', null)
      .gte('created_at', new Date(from.getTime() - 120 * 86_400_000).toISOString())
      .limit(3000),
  ])

  const inMonth = (iso: string | null | undefined) => {
    if (!iso) return false
    const t = new Date(iso).getTime()
    return t >= from.getTime() && t < to.getTime()
  }

  type Agg = { managerId: string | null; name: string; launched: number; paid: number; count: number }
  const byManager = new Map<string, Agg>()
  for (const o of (orders ?? []) as Record<string, unknown>[]) {
    const managerId = (o.created_by as string | null) ?? null
    if (!seeAll && managerId !== user.id) continue
    const n = parseNotes(o.notes)
    const launchedAt = (o.launched_at as string | null) ?? (n.launched_at as string | null) ?? null
    const total = finalTotalOf(o as { total_after_discount?: number; total_sale_inc_vat?: number })
    const key = managerId ?? 'none'
    const agg = byManager.get(key) ?? {
      managerId, name: (o.created_by_name as string | null) ?? 'без автора', launched: 0, paid: 0, count: 0,
    }
    if (inMonth(launchedAt)) { agg.launched += total; agg.count += 1 }
    if (n.payment_status === 'paid' && inMonth((n.paid_at as string | null) ?? launchedAt)) agg.paid += total
    byManager.set(key, agg)
  }

  const planByManager = new Map<string, number>()
  for (const p of (plans ?? []) as { manager_id: string; plan_amount: number }[]) {
    planByManager.set(p.manager_id, Number(p.plan_amount) || 0)
  }

  const now = new Date()
  const sameMonth = monthKey(now) === month
  const daysInMonth = new Date(to.getTime() - 86_400_000).getDate()
  const dayOfMonth = sameMonth ? now.getDate() : daysInMonth

  const rows = [...byManager.values()].map(a => {
    const plan = a.managerId ? planByManager.get(a.managerId) ?? 0 : 0
    // Прогноз — линейная экстраполяция темпа. Это оценка, не обещание.
    const forecast = dayOfMonth > 0 ? Math.round(a.launched / dayOfMonth * daysInMonth) : a.launched
    return { ...a, plan, forecast, donePct: plan > 0 ? Math.round(a.launched / plan * 100) : null }
  }).sort((x, y) => y.launched - x.launched)

  return NextResponse.json({ month, seeAll, daysInMonth, dayOfMonth, rows })
}

export async function POST(req: NextRequest) {
  const guard = await requireRole(['admin', 'ceo', 'commercial'])
  if (guard instanceof NextResponse) return guard

  const b = await req.json().catch(() => ({}))
  const managerId = typeof b?.managerId === 'string' ? b.managerId : null
  const month = typeof b?.month === 'string' && /^\d{4}-\d{2}$/.test(b.month) ? b.month : null
  const amount = Math.max(0, Math.round(Number(b?.amount) || 0))
  if (!managerId || !month) return NextResponse.json({ error: 'Нужны менеджер и месяц' }, { status: 400 })

  const sb = await createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  let name: string | null = null
  if (user?.id) {
    const { data: prof } = await sb.from('users').select('name').eq('id', user.id).maybeSingle()
    name = (prof?.name as string | null) ?? user.email ?? null
  }

  const { error } = await sb.from('b2b_manager_plans').upsert({
    manager_id: managerId, month, plan_amount: amount,
    note: typeof b?.note === 'string' ? b.note.slice(0, 300) : '',
    updated_by: user?.id ?? null, updated_by_name: name, updated_at: new Date().toISOString(),
  }, { onConflict: 'manager_id,month' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
