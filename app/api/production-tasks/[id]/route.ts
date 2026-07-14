import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { mirrorOrderStages } from '@/lib/productionOrderMirror'

// PATCH — отметка производственной задачи рабочим (Выполнено / Проблема).
// Двойная запись: production_tasks (новая модель очередей) И notes.detail_stages
// (старая модель прогресса на уровне заказа), чтобы прогресс в /b2b-orders
// оставался правдивым в переходный период.
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
    .select('id, order_id, item_index, stage_key, status, started_at')
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

  // 2) notes.detail_stages (зеркалим для прогресса на уровне заказа). Best-effort.
  if (action === 'done' || action === 'problem') {
    const { data: order } = await svc.from('b2b_orders').select('notes').eq('id', task.order_id).single()
    if (order) {
      const notes = typeof order.notes === 'string'
        ? (() => { try { return JSON.parse(order.notes) } catch { return {} } })()
        : (order.notes ?? {})
      const ds = (notes.detail_stages ?? {}) as Record<string, Record<string, unknown>>
      const key = String(task.item_index)
      ds[key] = ds[key] ?? {}
      if (action === 'done') {
        ds[key][task.stage_key] = { status: 'done', updated_at: now, updated_by: user.id, updated_by_email: user.email ?? undefined }
      } else {
        ds[key][task.stage_key] = { status: 'problem', updated_at: now, updated_by: user.id, reason: body.reason_code ?? 'other', note: body.comment ?? undefined }
      }
      notes.detail_stages = ds
      await svc.from('b2b_orders').update({ notes: JSON.stringify(notes) }).eq('id', task.order_id)
    }
  }

  // 3) третье зеркало: если все позиции этапа закрыты — проставить order-level флаг (для /b2b-orders/Сводки)
  if (action === 'done') await mirrorOrderStages(svc, task.order_id)

  return NextResponse.json({ ok: true })
}
