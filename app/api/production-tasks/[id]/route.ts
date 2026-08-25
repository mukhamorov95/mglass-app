import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { requireRole } from '@/lib/apiAuth'
import { mirrorOrderStages } from '@/lib/productionOrderMirror'
import { cascadePriorStages } from '@/lib/productionCascade'
import { actorName, buildTaskUpdate, type TaskAction } from '@/lib/production/executor'

// Действия цеха доступны рабочим производства и владельцу (+ закупщик Вера,
// надзор за цехом). Проверка на СЕРВЕРЕ, не только скрытием кнопок в UI (№3).
const SHOP_ROLES = ['production', 'admin', 'ceo', 'buyer'] as const

// PATCH — отметка производственной задачи рабочим (Выполнено / Проблема).
// Двойная запись: production_tasks (новая модель очередей) И notes.detail_stages
// (старая модель прогресса на уровне заказа), чтобы прогресс в /b2b-orders
// оставался правдивым в переходный период.
// «Готово» на этапе закрывает и все предыдущие этапы детали (см. productionCascade).
// Исполнитель (completed_by) берётся из сессии — рабочий не делает лишних действий (П1).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  const guard = await requireRole([...SHOP_ROLES])
  if (guard instanceof NextResponse) return guard

  const { id } = await params
  const taskId = Number(id)
  if (!taskId) return NextResponse.json({ error: 'Неверный id' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const action = body.action as TaskAction | undefined
  if (!action || !['done', 'problem', 'start'].includes(action)) {
    return NextResponse.json({ error: 'action: done|problem|start' }, { status: 400 })
  }

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  // Профиль тянем параллельно с задачей — «Готово» жмут сотни раз за смену,
  // лишний последовательный round-trip тут стоит дороже, чем выглядит.
  const [{ data: task, error: tErr }, { data: prof }] = await Promise.all([
    svc.from('production_tasks')
      .select('id, order_id, item_index, stage_key, status, started_at, sequence_order, assigned_to')
      .eq('id', taskId)
      .single(),
    supabase.from('users').select('name').eq('id', user.id).maybeSingle(),
  ])
  if (tErr || !task) return NextResponse.json({ error: 'Задача не найдена' }, { status: 404 })

  const actor = { id: user.id, name: actorName((prof as { name: string | null } | null)?.name, user.email) }

  // Материал резку НЕ блокирует (решение владельца 14.07): мастер режет сразу,
  // «материала нет» — только подсветка заказа на закупку, без задержек.

  const now = new Date().toISOString()

  // 1) production_tasks
  const upd = buildTaskUpdate(action, actor, task, now, {
    reasonCode: body.reason_code ?? 'other',
    comment:    body.comment ?? null,
  })
  const { error: uErr } = await svc.from('production_tasks').update(upd).eq('id', taskId)
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 })

  // 1а) каскад: закрытый этап означает, что все предыдущие этапы детали пройдены.
  // Исполнителя каскадным задачам НЕ ставим — их физически никто не отмечал (см. productionCascade).
  const cascaded = action === 'done'
    ? await cascadePriorStages(svc, task.order_id, task.item_index, task.sequence_order, now)
    : []

  // 2) notes.detail_stages (зеркалим для прогресса на уровне заказа).
  // АТОМАРНО через mark_detail_stages: правка под блокировкой строки, чтобы
  // одновременные отметки по одному заказу не затирали друг друга (причина №2).
  if (action === 'done' || action === 'problem') {
    const item = String(task.item_index)
    const updates: { item: string; stage: string; entry: Record<string, unknown> }[] = []
    if (action === 'done') {
      updates.push({ item, stage: task.stage_key, entry: { status: 'done', updated_at: now, updated_by: user.id, updated_by_email: user.email ?? undefined } })
      for (const st of cascaded) {
        updates.push({ item, stage: st, entry: { status: 'done', updated_at: now, updated_by: user.id, updated_by_email: user.email ?? undefined, auto: true } })
      }
    } else {
      updates.push({ item, stage: task.stage_key, entry: { status: 'problem', updated_at: now, updated_by: user.id, reason: body.reason_code ?? 'other', note: body.comment ?? undefined } })
    }
    await svc.rpc('mark_detail_stages', { p_order_id: task.order_id, p_updates: updates })
  }

  // 3) третье зеркало: если все позиции этапа закрыты — проставить order-level флаг (для /b2b-orders/Сводки)
  if (action === 'done') await mirrorOrderStages(svc, task.order_id)

  return NextResponse.json({ ok: true, cascaded })
}
