import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { resolvePartnerMember } from '@/lib/partnerClient'
import { shipLines, type ShipOrder } from '@/lib/production/clientShipments'
import type { BoardTask } from '@/lib/production/ordersBoard'
import { earlierLines, loadShippedLines } from '@/lib/partner/shipProgress'
import { itemStages } from '@/lib/partner/itemStages'

// Этапы цеха по деталям одного заказа — только свой заказ (client_id = клиент партнёра).
// Наружу: название детали, размер, штуки, этапы с автором и временем. Без проблем цеха и сумм.

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  const svc = createServiceClient()
  const pm = await resolvePartnerMember<{ id: number }>(svc, user.id, 'id')
  if (!pm) return NextResponse.json({ error: 'Аккаунт не привязан' }, { status: 403 })

  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Нет такого заказа' }, { status: 404 })
  const { data: o, error } = await svc.from('b2b_orders')
    .select('id, client_id, items, notes, discount_percent, total_sale_inc_vat, total_after_discount')
    .eq('id', id).eq('client_id', pm.client.id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!o) return NextResponse.json({ error: 'Нет такого заказа' }, { status: 404 })

  const { data: tasks, error: tErr } = await svc.from('production_tasks')
    .select('item_index, stage_key, status, sequence_order, completed_at, completed_by_name, auto_closed, auto_closed_by_name, auto_closed_from')
    .eq('order_id', id).order('sequence_order').order('id')
  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 })

  let shipped: Map<string, number>
  try { shipped = await loadShippedLines(svc, [id]) }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }) }
  let notes: Record<string, unknown> = {}
  try { notes = o.notes ? JSON.parse(o.notes as string) : {} } catch { notes = {} }
  const earlier = earlierLines(notes)

  const items = itemStages(shipLines(o as unknown as ShipOrder), (tasks ?? []) as BoardTask[],
    k => (shipped.get(`${id}:${k}`) ?? 0) + (earlier[k] ?? 0))
  return NextResponse.json({ items })
}
