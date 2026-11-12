import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { getSessionUser } from '@/lib/getRole'
import { serviceAsMe } from '@/lib/serviceAs'
import { OWN_COST_ROLES } from '@/lib/b2b/ownCostRemake'

// Отметка «за счёт M GLASS» (владелец 12.11.2026): переделка по нашей вине, клиенту не выставляется.
// Это решение о деньгах, поэтому ставят владелец и финансист; автор и время — в самой отметке и в журнале.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireRole([...OWN_COST_ROLES])
  if (guard instanceof NextResponse) return guard
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  const orderId = Number((await params).id)
  if (!Number.isInteger(orderId) || orderId <= 0) return NextResponse.json({ error: 'Плохой номер заказа' }, { status: 400 })
  const body = await req.json().catch(() => ({})) as { on?: unknown; of?: unknown }
  const on = body.on === true
  const of = typeof body.of === 'string' ? body.of.trim().slice(0, 20) : ''

  const svc = await serviceAsMe()
  const { data: order, error: oErr } = await svc.from('b2b_orders').select('id').eq('id', orderId).maybeSingle()
  if (oErr) return NextResponse.json({ error: oErr.message }, { status: 500 })
  if (!order) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 })
  const { data: prof } = await svc.from('users').select('name').eq('id', user.id).maybeSingle()
  const by = (prof as { name: string | null } | null)?.name ?? user.email ?? null

  const value = on ? { of: of || null, by, at: new Date().toISOString() } : null
  const { error } = await svc.rpc('patch_order_notes_shallow', { p_order_id: orderId, p_patch: { own_cost_remake: value } })
  if (error) return NextResponse.json({ error: `Отметка не записана: ${error.message}` }, { status: 500 })
  return NextResponse.json({ ok: true, own_cost_remake: value })
}
