import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { mirrorOrderStages } from '@/lib/productionOrderMirror'
import { cascadePriorStages, reverseCascade, type CascadedStage } from '@/lib/productionCascade'
import { buildSyncDonePatch, UNSET_TASK_PATCH } from '@/lib/production/executor'
import { consumeCutting, loadCascadedTasks, reverseCutting } from '@/lib/production/consumeBridge'

// Отметка этапа позиции вне очереди цеха: карточка заказа, QR, экран отгрузки. Одна запись на всех:
// задача, каскад предыдущих этапов, откат каскада, склад и зеркало на уровне заказа.

export type StageUpdate = { item_index: number; stage_key: string; action: 'done' | 'unset' }
export type StageActor = { id: string; name: string | null; email?: string | null }

export async function applyStageUpdates(svc: SupabaseClient, orderId: number, updates: StageUpdate[], actor: StageActor) {
  const now = new Date().toISOString()
  const actor2 = { userId: actor.id, name: actor.name ?? undefined }
  let updated = 0

  // Материал резку НЕ блокирует (решение владельца 14.07, как в /api/production-tasks/[id]):
  // мастер режет сразу, «материала нет» — только подсветка заказа на закупку. Здесь до
  // 07.10 жил гейт по незакрытой закупке: карточка заказа показывала «Сохранено», а
  // резка молча не доходила до очереди цеха.

  const failed: string[] = []
  const cascaded: CascadedStage[] = []
  const reopened: { item_index: number; stages: string[] }[] = []
  for (const u of updates) {
    // 'problem' — псевдоэтап старой модели, в production_tasks реального stage нет: пропускаем.
    if (!u || u.stage_key === 'problem' || typeof u.item_index !== 'number') continue

    const patch: Record<string, unknown> = u.action === 'unset'
      ? { ...UNSET_TASK_PATCH }
      : buildSyncDonePatch(actor, now)

    // При отмене нужен completed_at ДО снятия: по нему опознаётся каскад, вызванный
    // именно этой отметкой (каскад ставит ту же метку времени, что и вызвавшая отметка).
    let prevCompletedAt: string | null = null
    let prevSeq: number | null = null
    let prevRework = 0
    if (u.action === 'unset') {
      const { data: before } = await svc.from('production_tasks')
        .select('completed_at, sequence_order, rework_count').eq('order_id', orderId)
        .eq('item_index', u.item_index).eq('stage_key', u.stage_key).maybeSingle()
      const b = before as { completed_at: string | null; sequence_order: number; rework_count: number | null } | null
      prevCompletedAt = b?.completed_at ?? null
      prevSeq = b?.sequence_order ?? null
      prevRework = b?.rework_count ?? 0
    }

    const { data, error } = await svc
      .from('production_tasks')
      .update(patch)
      .eq('order_id', orderId)
      .eq('item_index', u.item_index)
      .eq('stage_key', u.stage_key)
      .select('id, sequence_order')

    if (error) { failed.push(`поз. ${u.item_index + 1}: ${error.message}`); continue }
    updated += data?.length ?? 0

    // Снятие отметки трогало только СВОЮ задачу: этапы, закрытые каскадом от неё, оставались
    // закрытыми, и заказ показывал «сделано» там, где отметку уже сняли. Возвращаем их тоже.
    if (u.action === 'unset' && !error) {
      const back = await reverseCascade(svc, orderId, u.item_index, prevCompletedAt, prevSeq)
      if (back.length) reopened.push({ item_index: u.item_index, stages: back })

      // Склад: снятая отметка — исправление ошибки, материал не расходовался. Откатываем и
      // снятый этап, и всё, что вернул каскад: мисклик по упаковке мог закрыть резку.
      const undone = [
        { item_index: u.item_index, stage_key: u.stage_key, rework_count: prevRework },
        ...await loadCascadedTasks(svc, orderId, u.item_index, back),
      ]
      await reverseCutting(orderId, undone, 'unset', actor2)
    }

    // Каскад: закрытый этап означает, что все предыдущие этапы детали пройдены.
    const seq = (data?.[0] as { sequence_order?: number } | undefined)?.sequence_order
    if (u.action === 'done' && typeof seq === 'number') {
      const keys = await cascadePriorStages(svc, orderId, u.item_index, seq, now,
        { id: actor2.userId, name: actor2.name, stage: u.stage_key })
      for (const k of keys) cascaded.push({ item_index: u.item_index, stage_key: k })

      // Склад: сама отметка (если это резка) и каскадные этапы.
      const { data: self } = await svc.from('production_tasks')
        .select('rework_count').eq('order_id', orderId)
        .eq('item_index', u.item_index).eq('stage_key', u.stage_key).maybeSingle()
      await consumeCutting(orderId, [{ item_index: u.item_index, stage_key: u.stage_key, rework_count: (self as { rework_count: number | null } | null)?.rework_count ?? 0 }], 'worker', actor2)
      await consumeCutting(orderId, await loadCascadedTasks(svc, orderId, u.item_index, keys), 'cascade', actor2)
    }
  }

  // Каскадно закрытые этапы дописываем в notes.detail_stages — иначе на старых
  // экранах они остались бы неотмеченными (вызывающий записал только свой этап).
  // АТОМАРНО (mark_detail_stages) — без гонки на перезаписи всего notes (причина №2).
  if (cascaded.length > 0) {
    const entries = cascaded.map(c => ({
      item: String(c.item_index), stage: c.stage_key,
      entry: { status: 'done', updated_at: now, updated_by: actor.id, updated_by_email: actor.email ?? undefined, auto: true },
    }))
    await svc.rpc('mark_detail_stages', { p_order_id: orderId, p_updates: entries })
  }

  // Третье зеркало: закрытые этапы (все позиции) → order-level notes.stages для /b2b-orders/Сводки
  await mirrorOrderStages(svc, orderId)

  return { updated, failed, cascaded, reopened }
}
