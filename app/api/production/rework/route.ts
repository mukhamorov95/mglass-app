import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { requireRole } from '@/lib/apiAuth'
import { actorName } from '@/lib/production/executor'
import {
  isReworkReason, pickReopen, REOPEN_TASK_PATCH, restartStageFor, type ReworkTask,
} from '@/lib/production/rework'
import { mirrorOrderStages } from '@/lib/productionOrderMirror'

// П3 — «Переделать»: маршрут детали возвращается назад, брак записывается побочным эффектом.
// Одно действие рабочего = одна запись в журнале переделок + переоткрытые задачи.

const SHOP_ROLES = ['production', 'admin', 'ceo', 'buyer'] as const

export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  const guard = await requireRole([...SHOP_ROLES])
  if (guard instanceof NextResponse) return guard

  const body = await req.json().catch(() => ({}))
  const taskId = Number(body.task_id)
  const reason = body.reason
  if (!taskId) return NextResponse.json({ error: 'Неверный id задачи' }, { status: 400 })
  if (!isReworkReason(reason)) return NextResponse.json({ error: 'Неизвестная причина' }, { status: 400 })
  const comment = typeof body.comment === 'string' ? body.comment.trim() || null : null

  const svc = createServiceClient()

  const [{ data: task, error: tErr }, { data: prof }] = await Promise.all([
    svc.from('production_tasks')
      .select('id, order_id, item_index, stage_key')
      .eq('id', taskId).single(),
    supabase.from('users').select('name').eq('id', user.id).maybeSingle(),
  ])
  if (tErr || !task) return NextResponse.json({ error: 'Задача не найдена' }, { status: 404 })
  const who = actorName((prof as { name: string | null } | null)?.name, user.email)

  const restartStage = restartStageFor(reason, task.stage_key)

  const { data: itemRows } = await svc.from('production_tasks')
    .select('id, stage_key, sequence_order, status')
    .eq('order_id', task.order_id).eq('item_index', task.item_index)
    .order('sequence_order', { ascending: true })
  const itemTasks = (itemRows ?? []) as ReworkTask[]

  const reopen = pickReopen(itemTasks, restartStage)
  const reopenIds = reopen.map(t => t.id)

  // Журнал пишем ПЕРВЫМ: если следом упадёт переоткрытие, у нас останется запись о браке
  // без изменённого маршрута — это чинится вручную. Обратный порядок дал бы переоткрытый
  // маршрут без записи, а это уже не чинится: причина известна только рабочему и только сейчас.
  const { error: logErr } = await svc.from('production_rework').insert({
    order_id:          task.order_id,
    item_index:        task.item_index,
    found_at_stage:    task.stage_key,
    restart_stage:     restartStage,
    reason_code:       reason,
    comment,
    by_user:           user.id,
    by_name:           who,
    reopened_task_ids: reopenIds,
  })
  if (logErr) return NextResponse.json({ error: logErr.message }, { status: 500 })

  if (reopenIds.length > 0) {
    const { error: upErr } = await svc.from('production_tasks')
      .update({ ...REOPEN_TASK_PATCH }).in('id', reopenIds)
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

    // rework_count инкрементит триггер на вставке в журнал — приложение его не ведёт.

    // Этапы детали снова открыты — order-level флаги могли перестать быть правдой.
    // Зеркало умеет только продвигать, поэтому снимаем те флаги, чьи задачи снова в очереди.
    await unmirrorReopenedStages(svc, task.order_id, reopen)
    await mirrorOrderStages(svc, task.order_id)
  }

  return NextResponse.json({ ok: true, restartStage, reopened: reopenIds.length })
}

const STAGE_TO_FLAG: Record<string, string> = {
  cutting: 'cut', polishing: 'edge_processed', drilling: 'drilled',
  tempering: 'tempering', packaging: 'packaged',
}

// Снять order-level флаги переоткрытых этапов. mirrorOrderStages сознательно только
// продвигает статус (чтобы не затирать ручные отметки менеджера), поэтому откат делаем
// здесь и явно: иначе заказ остался бы «упакован» с деталью, которую заново режут.
async function unmirrorReopenedStages(
  svc: ReturnType<typeof createServiceClient>,
  orderId: number,
  reopened: ReworkTask[],
): Promise<void> {
  const flags = [...new Set(reopened.map(t => STAGE_TO_FLAG[t.stage_key]).filter(Boolean))]
  if (flags.length === 0) return
  const patch: Record<string, null> = {}
  for (const f of flags) patch[f] = null   // null в mark_order_stages = удалить ключ
  await svc.rpc('mark_order_stages', { p_order_id: orderId, p_stages: patch })
}
