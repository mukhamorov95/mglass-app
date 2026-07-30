import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { mirrorOrderStages } from '@/lib/productionOrderMirror'
import { cascadePriorStages } from '@/lib/productionCascade'

// PATCH — отметка производственной задачи рабочим (Выполнено / Проблема).
// Двойная запись: production_tasks (новая модель очередей) И notes.detail_stages
// (старая модель прогресса на уровне заказа), чтобы прогресс в /b2b-orders
// оставался правдивым в переходный период.
// «Готово» на этапе закрывает и все предыдущие этапы детали (см. productionCascade).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const { id } = await params
  const taskId = Number(id)
  if (!taskId) return NextResponse.json({ error: 'Неверный id' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const action = body.action as 'done' | 'problem' | 'start' | undefined
  if (!action || !['done', 'problem', 'start'].includes(action)) {
    return NextResponse.json({ error: 'action: done|problem|start' }, { status: 400 })
  }

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: task, error: tErr } = await svc
    .from('production_tasks')
    .select('id, order_id, item_index, stage_key, status, started_at, sequence_order')
    .eq('id', taskId)
    .single()
  if (tErr || !task) return NextResponse.json({ error: 'Задача не найдена' }, { status: 404 })

  // Материал резку НЕ блокирует (решение владельца 14.07): мастер режет сразу,
  // «материала нет» — только подсветка заказа на закупку, без задержек.

  const now = new Date().toISOString()

  // 1) production_tasks
  const upd: Record<string, unknown> = {}
  if (action === 'start') {
    upd.status = 'in_progress'
    upd.started_at = task.started_at ?? now
  } else if (action === 'done') {
    upd.status = 'done'
    upd.completed_at = now
    upd.started_at = task.started_at ?? now
    upd.problem_resolved_at = now   // снимаем андон, если был
  } else {
    upd.status = 'problem'
    upd.problem_reason_code = body.reason_code ?? 'other'
    upd.problem_comment = body.comment ?? null
    upd.problem_at = now
    upd.problem_resolved_at = null
  }
  const { error: uErr } = await svc.from('production_tasks').update(upd).eq('id', taskId)
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 })

  // 1а) каскад: закрытый этап означает, что все предыдущие этапы детали пройдены
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
