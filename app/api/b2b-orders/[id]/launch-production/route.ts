import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { requireRole } from '@/lib/apiAuth'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { buildProductionTasks } from '@/lib/productionRouting'
import { parseNotes } from '@/lib/orderFlags'
import { makeDaysFor } from '@/lib/contractDeadlines'
import { addWorkingDays } from '@/lib/b2b/deadline'

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
  // Запуск в работу — менеджеры/владелец/закупщик, не любой залогиненный (№3).
  const guard = await requireRole(['manager', 'commercial', 'admin', 'ceo', 'buyer'])
  if (guard instanceof NextResponse) return guard

  const { id } = await params
  const orderId = Number(id)
  if (!orderId) return NextResponse.json({ error: 'Неверный id заказа' }, { status: 400 })

  const svc = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: order, error: orderErr } = await svc
    .from('b2b_orders')
    .select('id, items, notes, launched_at')
    .eq('id', orderId)
    .single()
  if (orderErr || !order) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 })

  const items = Array.isArray(order.items) ? order.items : []

  // А1: гарантируем срок отгрузки. Раньше deadline_date ставился (или нет) только на
  // клиенте — у 61% заказов его не было → цех не мог сортировать по сроку, партнёр
  // видел «уточняется». Если пусто — считаем от даты запуска: 15 р.дн. (сварное — 25),
  // пропуская выходные. Не перетираем уже заданный менеджером срок.
  const notes = parseNotes(order.notes)
  if (!notes.deadline_date) {
    const makeDays = makeDaysFor(items)
    const from = order.launched_at ? new Date(order.launched_at as string) : new Date()
    const deadline = addWorkingDays(from, makeDays)
    // Атомарный shallow-patch (не перезапись всего notes) — заказ уже в проде,
    // рядом могут идти правки стадий.
    await svc.rpc('patch_order_notes_shallow', {
      p_order_id: orderId,
      p_patch: { deadline_date: deadline.toISOString().slice(0, 10), production_days: (notes.production_days as number) || makeDays },
    })
  }
  const rows = buildProductionTasks(orderId, items)
  if (rows.length === 0) return NextResponse.json({ created: 0, skipped: 0 })

  const { data: inserted, error: insertErr } = await svc
    .from('production_tasks')
    .upsert(rows, { onConflict: 'order_id,item_index,stage_key,layer', ignoreDuplicates: true })
    .select('id, item_index, sequence_order')
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

  // Second pass: blocked_by_task_id.
  // Слои (layer >= 1) — независимые цепочки: этапы одного стекла идут друг за другом,
  // а стёкла пакета режутся/обрабатываются параллельно. Задачи изделия (layer = 0:
  // склейка триплекса, упаковка) стартуют после ПОСЛЕДНЕЙ послойной задачи и чейнятся между собой.
  const { data: allTasks, error: fetchErr } = await svc
    .from('production_tasks')
    .select('id, item_index, sequence_order, blocked_by_task_id, layer')
    .eq('order_id', orderId)
    .order('item_index', { ascending: true })
    .order('sequence_order', { ascending: true })
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })

  type T = { id: number; item_index: number; sequence_order: number; blocked_by_task_id: number | null; layer: number | null }
  const byItem = new Map<number, T[]>()
  for (const t of (allTasks ?? []) as T[]) {
    const list = byItem.get(t.item_index) ?? []
    list.push(t)
    byItem.set(t.item_index, list)
  }

  const updates: { id: number; blocked_by_task_id: number | null }[] = []
  const want = new Map<number, number | null>()
  for (const list of byItem.values()) {
    const layerChains = new Map<number, T[]>()   // layer >= 1
    const itemChain: T[] = []                    // layer = 0
    for (const t of list) {
      const ly = t.layer ?? 1
      if (ly === 0) itemChain.push(t)
      else { const c = layerChains.get(ly) ?? []; c.push(t); layerChains.set(ly, c) }
    }
    let lastOfLayers: T | null = null
    for (const chain of layerChains.values()) {
      for (let i = 0; i < chain.length; i++) want.set(chain[i].id, i === 0 ? null : chain[i - 1].id)
      const last = chain[chain.length - 1]
      if (!lastOfLayers || last.sequence_order > lastOfLayers.sequence_order) lastOfLayers = last
    }
    for (let i = 0; i < itemChain.length; i++) {
      want.set(itemChain[i].id, i === 0 ? (lastOfLayers?.id ?? null) : itemChain[i - 1].id)
    }
  }
  for (const list of byItem.values()) {
    for (const t of list) {
      const w = want.get(t.id) ?? null
      if (t.blocked_by_task_id !== w) updates.push({ id: t.id, blocked_by_task_id: w })
    }
  }
  for (const u of updates) {
    await svc.from('production_tasks').update({ blocked_by_task_id: u.blocked_by_task_id }).eq('id', u.id)
  }

  return NextResponse.json({ created: inserted?.length ?? 0, linked: updates.length })
}
