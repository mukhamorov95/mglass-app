import type { SupabaseClient } from '@supabase/supabase-js'
import {
  planRework, reopenedStageEntries, REOPEN_TASK_PATCH, REWORK_REASON_LABELS,
  type ReworkReason, type ReworkTask,
} from '@/lib/production/rework'
import { mirrorOrderStages } from '@/lib/productionOrderMirror'
import { notifyOrderManager } from '@/lib/b2b/notifyManager'
import { reworkNotice, orderLink } from '@/lib/production/managerNotices'

// Одно действие «переделать»: журнал брака, переоткрытый маршрут, зеркало заказа, сообщение менеджеру.
// Зовут очередь и карточка заказа (/api/production/rework) и приёмка с закалки.

export type ReworkInput = {
  order: { id: number; custom_number: string | null; client_name: string | null }
  itemIndex: number
  reason: ReworkReason
  comment: string | null
  foundTaskId?: number
  dryRun?: boolean
  actor: { id: string; name: string | null }
}
export type ReworkOutcome = { error: string; status: number } | {
  ok: true; dryRun?: true; id?: number; itemIndex: number; foundAtStage: string; restartStage: string; reopen: number
  noRoute: boolean; reopened?: number; notified?: boolean; warnings?: string[]
}

export async function applyRework(svc: SupabaseClient, input: ReworkInput): Promise<ReworkOutcome> {
  const { order: o, itemIndex, reason, comment, foundTaskId, dryRun, actor } = input
  const orderId = o.id

  const { data: itemRows, error: iErr } = await svc.from('production_tasks')
    .select('id, stage_key, sequence_order, status')
    .eq('order_id', orderId).eq('item_index', itemIndex)
    .order('sequence_order', { ascending: true })
  if (iErr) return { error: iErr.message, status: 500 }
  const itemTasks = (itemRows ?? []) as ReworkTask[]

  const plan = planRework(itemTasks, reason, foundTaskId)
  const reopenIds = plan.reopen.map(t => t.id)
  const summary = {
    itemIndex,
    foundAtStage: plan.foundAtStage,
    restartStage: plan.restartStage,
    reopen:       reopenIds.length,
    noRoute:      itemTasks.length === 0,
  }
  if (dryRun) return { ok: true, dryRun: true, ...summary }

  // Журнал пишем ПЕРВЫМ: если следом упадёт переоткрытие, у нас останется запись о браке
  // без изменённого маршрута — это чинится вручную. Обратный порядок дал бы переоткрытый
  // маршрут без записи, а это уже не чинится: причина известна только рабочему и только сейчас.
  // .select('id'): «записано» говорим по вернувшейся строке, а не по отсутствию ошибки.
  const { data: logRows, error: logErr } = await svc.from('production_rework').insert({
    order_id:          orderId,
    item_index:        itemIndex,
    found_at_stage:    plan.foundAtStage,
    restart_stage:     plan.restartStage,
    reason_code:       reason,
    comment,
    by_user:           actor.id,
    by_name:           actor.name,
    reopened_task_ids: reopenIds,
  }).select('id')
  if (logErr) {
    // 23514 — CHECK причин: новые коды разрешает миграция 20261014_production_rework_reasons.sql.
    const msg = logErr.code === '23514'
      ? 'Причина ещё не включена в базе — нужна миграция 20261014_production_rework_reasons.sql. Скажите начальнику цеха'
      : logErr.message
    return { error: msg, status: 500 }
  }
  const logId = (logRows ?? [])[0]?.id as number | undefined
  if (logId == null) return { error: 'Запись о браке не вернулась из базы — не сохранено', status: 500 }

  const warnings: string[] = []
  if (reopenIds.length > 0) {
    const { data: upRows, error: upErr } = await svc.from('production_tasks')
      .update({ ...REOPEN_TASK_PATCH }).in('id', reopenIds).select('id')
    if (upErr) return { error: `Брак записан (№${logId}), но маршрут не переоткрыт: ${upErr.message}`, status: 500 }
    if ((upRows ?? []).length !== reopenIds.length) {
      warnings.push(`переоткрыто ${(upRows ?? []).length} из ${reopenIds.length} этапов`)
    }

    // rework_count инкрементит триггер на вставке в журнал — приложение его не ведёт.

    // Этапы детали снова открыты — order-level флаги могли перестать быть правдой.
    // Зеркало умеет только продвигать, поэтому снимаем те флаги, чьи задачи снова в очереди.
    await unmirrorReopenedStages(svc, orderId, plan.reopen)
    await mirrorOrderStages(svc, orderId)

    const entries = reopenedStageEntries(itemIndex, plan.reopen, {
      at: new Date().toISOString(), by: actor.id, reasonLabel: REWORK_REASON_LABELS[reason] ?? reason,
    })
    const { error: dsErr } = await svc.rpc('mark_detail_stages', { p_order_id: orderId, p_updates: entries })
    if (dsErr) warnings.push(`карточка заказа ещё показывает этапы готовыми: ${dsErr.message}`)
  }

  // Менеджер узнаёт о браке от цеха, а не от клиента: деталь пошла заново, срок может
  // сдвинуться. Одно действие рабочего — одна запись в журнале — одно сообщение.
  // Сбой отправки переделку не отменяет.
  let notified = false
  try {
    notified = await notifyOrderManager(orderId, reworkNotice(
      { id: orderId, custom_number: o.custom_number, client_name: o.client_name },
      { foundAt: plan.foundAtStage, restartAt: plan.restartStage, reason, comment, itemIndex, by: actor.name, reopened: reopenIds.length },
    ), orderLink(orderId))
  } catch { /* уведомление — побочный эффект */ }

  return { ok: true, id: logId, ...summary, reopened: reopenIds.length, notified, warnings }
}

const STAGE_TO_FLAG: Record<string, string> = {
  cutting: 'cut', polishing: 'edge_processed', drilling: 'drilled',
  tempering: 'tempering', packaging: 'packaged',
}

// Снять order-level флаги переоткрытых этапов. mirrorOrderStages сознательно только
// продвигает статус (чтобы не затирать ручные отметки менеджера), поэтому откат делаем
// здесь и явно: иначе заказ остался бы «упакован» с деталью, которую заново режут.
export async function unmirrorReopenedStages(svc: SupabaseClient, orderId: number, reopened: ReworkTask[]): Promise<void> {
  const flags = [...new Set(reopened.map(t => STAGE_TO_FLAG[t.stage_key]).filter(Boolean))]
  if (flags.length === 0) return
  const patch: Record<string, null> = {}
  for (const f of flags) patch[f] = null   // null в mark_order_stages = удалить ключ
  await svc.rpc('mark_order_stages', { p_order_id: orderId, p_stages: patch })
}
