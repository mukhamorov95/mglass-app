import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { consumeCutting } from './consumeBridge'
import { OPEN_STATUSES, pickTasksToClose, type OrderMark } from './managerCascade'

// Запись к lib/production/managerCascade.ts: закрыть открытые задачи цеха заказа,
// который отметили упакованным или отгруженным мимо цеха. Ошибку возвращаем, а не
// бросаем — отметка заказа уже записана и откатываться из-за очереди цеха не должна.

type Row = { id: number; item_index: number; stage_key: string; status: string; rework_count: number | null }

export async function closeOpenTasksOnOrderMark(
  svc: SupabaseClient,
  orderId: number,
  mark: OrderMark,
  from: string,
  actor: { id?: string | null; name?: string | null },
): Promise<{ closed: number; error?: string }> {
  const { data, error } = await svc.from('production_tasks')
    .select('id, item_index, stage_key, status, rework_count')
    .eq('order_id', orderId).in('status', [...OPEN_STATUSES])
    .order('id')
  if (error) return { closed: 0, error: error.message }
  const targets = pickTasksToClose((data ?? []) as Row[], mark)
  if (targets.length === 0) return { closed: 0 }

  const now = new Date().toISOString()
  // completed_by не ставим: этап прошёл, но никто из цеха его не отмечал (см. productionCascade).
  // Повторная проверка статуса в условии — чтобы не перетереть живую отметку, сделанную
  // между чтением и записью.
  const { data: upd, error: uErr } = await svc.from('production_tasks')
    .update({
      status: 'done', completed_at: now, problem_resolved_at: now,
      auto_closed: true, auto_closed_from: from,
      auto_closed_by: actor.id ?? null, auto_closed_by_name: actor.name ?? null,
    })
    .in('id', targets.map(t => t.id)).in('status', [...OPEN_STATUSES])
    .select('id, item_index, stage_key, status, rework_count')
  if (uErr) return { closed: 0, error: uErr.message }
  const closed = (upd ?? []) as Row[]
  if (closed.length === 0) return { closed: 0 }

  // Старые экраны (карточка заказа, QR) читают notes.detail_stages — без этой записи
  // там закрытые этапы выглядели бы открытыми.
  await svc.rpc('mark_detail_stages', {
    p_order_id: orderId,
    p_updates: closed.map(t => ({
      item: String(t.item_index), stage: t.stage_key,
      entry: { status: 'done', updated_at: now, updated_by: actor.id ?? undefined, auto: true },
    })),
  })

  // Склад: закрытая каскадом резка — израсходованный лист, как у любого каскада.
  // Без имени: каскад говорит «этап был», а не «его сделал этот человек».
  await consumeCutting(orderId, closed.filter(t => t.stage_key === 'cutting'), 'cascade', {})

  return { closed: closed.length }
}
