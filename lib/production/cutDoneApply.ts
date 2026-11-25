import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildTaskUpdate, UNSET_TASK_PATCH, type Actor } from '@/lib/production/executor'
import { cascadePriorStages, reverseCascade } from '@/lib/productionCascade'
import { consumeCutting, loadCascadedTasks, reverseCutting } from '@/lib/production/consumeBridge'
import { mirrorOrderStages } from '@/lib/productionOrderMirror'
import { pickCutTasks, type CutPosition, type CutSkip, type CutTask } from '@/lib/production/cutterPlan'

// «Отрезано» в режиме резчика (docs/production/SHOP_DATA_ROUTE.md, П1). Порядок записи тот
// же, что в complete-my-stage: задача → каскад → этапы детали → склад → этапы заказа.

const COLS = 'id, item_index, layer, status, sequence_order, stage_key, rework_count, started_at, assigned_to, started_by'

export type CutMarked = { task_id: number; order_id: number; item_index: number; layer: number; was_assigned: boolean }
export type CutResult = { at: string; done: CutMarked[]; skipped: CutSkip[]; flagged: number[]; errors: string[] }
type CutActor = Actor & { email?: string | null }

const byOrder = <T extends { order_id: number }>(list: T[]) => {
  const m = new Map<number, T[]>()
  for (const x of list) m.set(x.order_id, [...(m.get(x.order_id) ?? []), x])
  return m
}

export async function applyCutDone(svc: SupabaseClient, wanted: CutPosition[], actor: CutActor): Promise<CutResult> {
  const now = new Date().toISOString()
  const by = { userId: actor.id, name: actor.name ?? undefined }
  const out: CutResult = { at: now, done: [], skipped: [], flagged: [], errors: [] }

  for (const [orderId, list] of byOrder(wanted)) {
    const { data, error } = await svc.from('production_tasks').select(COLS).eq('order_id', orderId).eq('stage_key', 'cutting')
    if (error) { out.errors.push(`заказ ${orderId}: ${error.message}`); continue }
    const { take, skipped } = pickCutTasks((data ?? []) as CutTask[], list, actor.id)
    out.skipped.push(...skipped)
    const entries: { item: string; stage: string; entry: Record<string, unknown> }[] = []
    const entry = { status: 'done', updated_at: now, updated_by: actor.id, updated_by_email: actor.email ?? undefined }

    for (const t of take) {
      // .neq: второе одновременное нажатие не перепишет автора уже закрытой задачи.
      const { data: rows, error: uErr } = await svc.from('production_tasks')
        .update(buildTaskUpdate('done', actor, t, now)).eq('id', t.id).neq('status', 'done').select('id')
      if (uErr) { out.errors.push(`заказ ${orderId}, поз. ${t.item_index + 1}: ${uErr.message}`); continue }
      const position = { order_id: orderId, item_index: t.item_index, layer: t.layer || 1 }
      if (!rows?.length) { out.skipped.push({ ...position, reason: 'already' }); continue }
      out.done.push({ ...position, task_id: t.id, was_assigned: !!t.assigned_to })

      const keys = await cascadePriorStages(svc, orderId, t.item_index, t.sequence_order, now,
        { id: actor.id, name: actor.name, stage: 'cutting' })
      entries.push({ item: String(t.item_index), stage: 'cutting', entry },
        ...keys.map(k => ({ item: String(t.item_index), stage: k, entry: { ...entry, auto: true } })))
      await consumeCutting(orderId, [{ item_index: t.item_index, stage_key: 'cutting', rework_count: t.rework_count ?? 0 }], 'cutter', by)
      await consumeCutting(orderId, await loadCascadedTasks(svc, orderId, t.item_index, keys), 'cascade', by)
    }

    if (!entries.length) continue
    const { error: dErr } = await svc.rpc('mark_detail_stages', { p_order_id: orderId, p_updates: entries })
    if (dErr) out.errors.push(`заказ ${orderId}: этапы деталей не записались (${dErr.message})`)
    if ((await mirrorOrderStages(svc, orderId)).includes('cut')) out.flagged.push(orderId)
  }
  return out
}

export type CutUndo = { at: string; tasks: { task_id: number; was_assigned: boolean }[]; flagged: number[] }

// Отмена возвращает ровно то, что закрыло это нажатие: свои задачи резки с той же меткой времени.
export async function undoCutDone(svc: SupabaseClient, undo: CutUndo, actor: CutActor): Promise<{ undone: number; errors: string[] }> {
  const ids = undo.tasks.map(t => t.task_id)
  const { data, error } = await svc.from('production_tasks').select(`order_id, completed_at, ${COLS}`)
    .in('id', ids).eq('stage_key', 'cutting').eq('status', 'done').eq('completed_by', actor.id).eq('completed_at', undo.at)
  if (error) return { undone: 0, errors: [error.message] }
  const wasAssigned = new Map(undo.tasks.map(t => [t.task_id, t.was_assigned]))
  const now = new Date().toISOString()
  const errors: string[] = []
  let undone = 0

  for (const [orderId, list] of byOrder((data ?? []) as unknown as (CutTask & { order_id: number; completed_at: string })[])) {
    const back: CutTask[] = []
    for (const t of list) {
      const { error: uErr } = await svc.from('production_tasks')
        .update({ ...UNSET_TASK_PATCH, assigned_to: wasAssigned.get(t.id) ? actor.id : null }).eq('id', t.id)
      if (uErr) { errors.push(`заказ ${orderId}, поз. ${t.item_index + 1}: ${uErr.message}`); continue }
      back.push(t)
      undone++
      await reverseCascade(svc, orderId, t.item_index, t.completed_at, t.sequence_order)
    }
    if (!back.length) continue

    const { data: rest, error: rErr } = await svc.from('production_tasks')
      .select('item_index, status, rework_count').eq('order_id', orderId).eq('stage_key', 'cutting')
    if (rErr) { errors.push(`заказ ${orderId}: ${rErr.message}`); continue }
    const cutting = (rest ?? []) as { item_index: number; status: string; rework_count: number | null }[]
    // Другое стекло той же позиции ещё отрезано — склад и этап детали остаются: ключ списания и
    // отметки детали общие на позицию.
    const alone = back.filter((t, i) => back.findIndex(x => x.item_index === t.item_index) === i
      && !cutting.some(c => c.item_index === t.item_index && c.status === 'done'))
    await reverseCutting(orderId, alone.map(t => ({ item_index: t.item_index, stage_key: 'cutting', rework_count: t.rework_count })), 'unset', { userId: actor.id, name: actor.name ?? undefined })
    if (alone.length) {
      const { error: dErr } = await svc.rpc('mark_detail_stages', {
        p_order_id: orderId,
        p_updates: alone.map(t => ({ item: String(t.item_index), stage: 'cutting', entry: { status: 'reopened', updated_at: now, updated_by: actor.id } })),
      })
      if (dErr) errors.push(`заказ ${orderId}: этапы деталей не вернулись (${dErr.message})`)
    }
    // Отметку «нарезан» у заказа снимаем, только если её поставило это нажатие.
    if (undo.flagged.includes(orderId) && cutting.some(c => c.status !== 'done')) {
      const { error: fErr } = await svc.rpc('mark_order_stages', { p_order_id: orderId, p_stages: { cut: null } })
      if (fErr) errors.push(`заказ ${orderId}: отметка «нарезан» не снялась (${fErr.message})`)
    }
  }
  return { undone, errors }
}
