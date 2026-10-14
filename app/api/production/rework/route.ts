import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { requireRole } from '@/lib/apiAuth'
import { actorName } from '@/lib/production/executor'
import {
  parseReworkBody, planRework, reopenedStageEntries, REOPEN_TASK_PATCH, REWORK_REASON_LABELS,
  type ReworkTask,
} from '@/lib/production/rework'
import { mirrorOrderStages } from '@/lib/productionOrderMirror'
import { notifyOrderManager } from '@/lib/b2b/notifyManager'
import { reworkNotice, orderLink } from '@/lib/production/managerNotices'

// П3 — «Переделать» / «Брак»: маршрут детали возвращается назад, брак записывается побочным
// эффектом. Одно действие рабочего = одна запись в журнале переделок + переоткрытые задачи.
// Зовут два экрана: очередь (task_id — задача, на которой нашли брак) и карточка заказа
// (order_id + item_index — место берётся из фронтира позиции). dry_run отдаёт план без записи:
// карточка показывает его в подтверждении («пойдёт заново с резки, вернётся 4 этапа»).

// Allow-list ролей цеха: менеджер, партнёр, замерщик сюда не проходят.
const SHOP_ROLES = ['production', 'admin', 'ceo', 'buyer'] as const

type Svc = ReturnType<typeof createServiceClient>

export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  const guard = await requireRole([...SHOP_ROLES])
  if (guard instanceof NextResponse) return guard

  const parsed = parseReworkBody(await req.json().catch(() => ({})))
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const { target, reason, comment, dryRun } = parsed.value

  const svc = createServiceClient()

  // Позиция: из задачи или прямо из запроса — тогда сверяем, что она есть в заказе.
  let orderId: number
  let itemIndex: number
  let foundTaskId: number | undefined
  if ('taskId' in target) {
    const { data: task, error: tErr } = await svc.from('production_tasks')
      .select('id, order_id, item_index').eq('id', target.taskId).maybeSingle()
    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 })
    if (!task) return NextResponse.json({ error: 'Задача не найдена' }, { status: 404 })
    orderId = task.order_id
    itemIndex = task.item_index
    foundTaskId = task.id
  } else {
    orderId = target.orderId
    itemIndex = target.itemIndex
  }

  const { data: ord, error: oErr } = await svc.from('b2b_orders')
    .select('id, items, custom_number, client_name').eq('id', orderId).maybeSingle()
  if (oErr) return NextResponse.json({ error: oErr.message }, { status: 500 })
  if (!ord) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 })
  const o = ord as { id: number; items: unknown; custom_number: string | null; client_name: string | null }
  const itemsCount = Array.isArray(o.items) ? o.items.length : 0
  if (!('taskId' in target) && itemIndex >= itemsCount) {
    return NextResponse.json({ error: `В заказе нет позиции ${itemIndex + 1}` }, { status: 400 })
  }

  const { data: itemRows, error: iErr } = await svc.from('production_tasks')
    .select('id, stage_key, sequence_order, status')
    .eq('order_id', orderId).eq('item_index', itemIndex)
    .order('sequence_order', { ascending: true })
  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 })
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
  if (dryRun) return NextResponse.json({ ok: true, dryRun: true, ...summary })

  const { data: prof } = await supabase.from('users').select('name').eq('id', user.id).maybeSingle()
  const who = actorName((prof as { name: string | null } | null)?.name, user.email)

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
    by_user:           user.id,
    by_name:           who,
    reopened_task_ids: reopenIds,
  }).select('id')
  if (logErr) {
    // 23514 — CHECK причин: новые коды разрешает миграция 20261014_production_rework_reasons.sql.
    const msg = logErr.code === '23514'
      ? 'Причина ещё не включена в базе — нужна миграция 20261014_production_rework_reasons.sql. Скажите начальнику цеха'
      : logErr.message
    return NextResponse.json({ error: msg }, { status: 500 })
  }
  const logId = (logRows ?? [])[0]?.id as number | undefined
  if (logId == null) return NextResponse.json({ error: 'Запись о браке не вернулась из базы — не сохранено' }, { status: 500 })

  const warnings: string[] = []
  if (reopenIds.length > 0) {
    const { data: upRows, error: upErr } = await svc.from('production_tasks')
      .update({ ...REOPEN_TASK_PATCH }).in('id', reopenIds).select('id')
    if (upErr) return NextResponse.json({ error: `Брак записан (№${logId}), но маршрут не переоткрыт: ${upErr.message}` }, { status: 500 })
    if ((upRows ?? []).length !== reopenIds.length) {
      warnings.push(`переоткрыто ${(upRows ?? []).length} из ${reopenIds.length} этапов`)
    }

    // rework_count инкрементит триггер на вставке в журнал — приложение его не ведёт.

    // Этапы детали снова открыты — order-level флаги могли перестать быть правдой.
    // Зеркало умеет только продвигать, поэтому снимаем те флаги, чьи задачи снова в очереди.
    await unmirrorReopenedStages(svc, orderId, plan.reopen)
    await mirrorOrderStages(svc, orderId)

    const entries = reopenedStageEntries(itemIndex, plan.reopen, {
      at: new Date().toISOString(), by: user.id, reasonLabel: REWORK_REASON_LABELS[reason] ?? reason,
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
      { foundAt: plan.foundAtStage, restartAt: plan.restartStage, reason, comment, itemIndex, by: who, reopened: reopenIds.length },
    ), orderLink(orderId))
  } catch { /* уведомление — побочный эффект */ }

  return NextResponse.json({ ok: true, id: logId, ...summary, reopened: reopenIds.length, notified, warnings })
}

const STAGE_TO_FLAG: Record<string, string> = {
  cutting: 'cut', polishing: 'edge_processed', drilling: 'drilled',
  tempering: 'tempering', packaging: 'packaged',
}

// Снять order-level флаги переоткрытых этапов. mirrorOrderStages сознательно только
// продвигает статус (чтобы не затирать ручные отметки менеджера), поэтому откат делаем
// здесь и явно: иначе заказ остался бы «упакован» с деталью, которую заново режут.
async function unmirrorReopenedStages(svc: Svc, orderId: number, reopened: ReworkTask[]): Promise<void> {
  const flags = [...new Set(reopened.map(t => STAGE_TO_FLAG[t.stage_key]).filter(Boolean))]
  if (flags.length === 0) return
  const patch: Record<string, null> = {}
  for (const f of flags) patch[f] = null   // null в mark_order_stages = удалить ключ
  await svc.rpc('mark_order_stages', { p_order_id: orderId, p_stages: patch })
}
