import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { buildProductionTasks } from '@/lib/productionRouting'

// POST — generates production_tasks rows for a B2B order's items when it's
// launched into production. Called best-effort from app/b2b-quotes/page.tsx
// handleConfirm; failure here must never block the order launch itself —
// b2b_orders.notes.stages/detail_stages remain the source of truth regardless.
// Idempotent: re-running for the same order does not duplicate or reset progress.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const { id } = await params
  const orderId = Number(id)
  if (!orderId) return NextResponse.json({ error: 'Неверный id заказа' }, { status: 400 })

  const svc = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: order, error: orderErr } = await svc
    .from('b2b_orders')
    .select('id, items')
    .eq('id', orderId)
    .single()
  if (orderErr || !order) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 })

  const items = Array.isArray(order.items) ? order.items : []
  const rows = buildProductionTasks(orderId, items)
  if (rows.length === 0) return NextResponse.json({ created: 0, skipped: 0 })

  const { data: inserted, error: insertErr } = await svc
    .from('production_tasks')
    .upsert(rows, { onConflict: 'order_id,item_index,stage_key', ignoreDuplicates: true })
    .select('id, item_index, sequence_order')
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

  // Second pass: link each task to the previous-stage task of the same item
  // via blocked_by_task_id. Re-fetch the full set for this order (covers both
  // newly-inserted and pre-existing rows from an earlier run).
  const { data: allTasks, error: fetchErr } = await svc
    .from('production_tasks')
    .select('id, item_index, sequence_order, blocked_by_task_id')
    .eq('order_id', orderId)
    .order('item_index', { ascending: true })
    .order('sequence_order', { ascending: true })
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })

  const byItem = new Map<number, typeof allTasks>()
  for (const t of allTasks ?? []) {
    const list = byItem.get(t.item_index) ?? []
    list.push(t)
    byItem.set(t.item_index, list)
  }

  const updates: { id: number; blocked_by_task_id: number | null }[] = []
  for (const list of byItem.values()) {
    for (let i = 0; i < list.length; i++) {
      const want = i === 0 ? null : list[i - 1].id
      if (list[i].blocked_by_task_id !== want) updates.push({ id: list[i].id, blocked_by_task_id: want })
    }
  }
  for (const u of updates) {
    await svc.from('production_tasks').update({ blocked_by_task_id: u.blocked_by_task_id }).eq('id', u.id)
  }

  return NextResponse.json({ created: inserted?.length ?? 0, linked: updates.length })
}
