import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseNotes } from '@/lib/orderFlags'
import { consumeCutting } from './consumeBridge'
import { OPEN_STATUSES, orderMarkOf, pickTasksToClose, pickTasksToReopen, type CascadedTask, type OrderMark } from './managerCascade'

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

// Обратное: снятие отметки возвращает в очередь задачи, закрытые ровно этим каскадом
// (from), если оставшаяся на заказе отметка их не покрывает. Склад не откатываем —
// списанный каскадом лист (consumeCutting) остаётся списанным, так же как consumeForOrder
// при снятии packaged: расхождение поймает инвентаризация, а не тумблер.
export async function reopenTasksOnOrderUnmark(
  svc: SupabaseClient,
  orderId: number,
  from: readonly string[],
  actor: { id?: string | null },
): Promise<{ reopened: number; error?: string }> {
  const { data: ord, error: oErr } = await svc.from('b2b_orders').select('notes').eq('id', orderId).maybeSingle()
  if (oErr) return { reopened: 0, error: oErr.message }
  const still = orderMarkOf((parseNotes((ord as { notes?: unknown } | null)?.notes).stages ?? {}) as Record<string, unknown>)

  const { data, error } = await svc.from('production_tasks')
    .select('id, item_index, stage_key, status, auto_closed, auto_closed_from, completed_by')
    .eq('order_id', orderId).eq('status', 'done').eq('auto_closed', true).in('auto_closed_from', [...from])
    .order('id')
  if (error) return { reopened: 0, error: error.message }
  const targets = pickTasksToReopen((data ?? []) as (CascadedTask & { item_index: number })[], from, still)
  if (targets.length === 0) return { reopened: 0 }

  // Условие повторяет отбор: задачу, которую между чтением и записью закрыл человек, не трогаем.
  const { data: upd, error: uErr } = await svc.from('production_tasks')
    .update({
      status: 'queued', completed_at: null, problem_resolved_at: null,
      auto_closed: false, auto_closed_from: null, auto_closed_by: null, auto_closed_by_name: null,
    })
    .in('id', targets.map(t => t.id)).eq('status', 'done').eq('auto_closed', true).is('completed_by', null)
    .select('id, item_index, stage_key')
  if (uErr) return { reopened: 0, error: uErr.message }
  const reopened = (upd ?? []) as { id: number; item_index: number; stage_key: string }[]
  if (reopened.length === 0) return { reopened: 0 }

  const now = new Date().toISOString()
  const { error: dErr } = await svc.rpc('mark_detail_stages', {
    p_order_id: orderId,
    p_updates: reopened.map(t => ({
      item: String(t.item_index), stage: t.stage_key,
      entry: { status: 'queued', updated_at: now, updated_by: actor.id ?? undefined, auto: true },
    })),
  })
  return { reopened: reopened.length, ...(dErr ? { error: `карточка заказа не обновилась: ${dErr.message}` } : {}) }
}
