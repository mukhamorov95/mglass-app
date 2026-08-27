import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { requireRole } from '@/lib/apiAuth'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { mirrorOrderStages } from '@/lib/productionOrderMirror'
import { isCuttingBlocked } from '@/lib/materialGate'
import { cascadePriorStages, reverseCascade, type CascadedStage } from '@/lib/productionCascade'
import { actorName, buildSyncDonePatch, UNSET_TASK_PATCH } from '@/lib/production/executor'

// Обратное зеркало: отметка этапа со «старых» экранов (orders/[id], /p/o) → production_tasks.
// Прямое зеркало (production_tasks → notes.detail_stages) живёт в /api/production-tasks/[id].
// Здесь замыкаем вторую сторону, чтобы обе модели прогресса были согласованы.
// Best-effort: у исторических заказов строк production_tasks нет — тогда просто ничего не трогаем.

type Update = { item_index: number; stage_key: string; action: 'done' | 'unset' }

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  const guard = await requireRole(['production', 'admin', 'ceo', 'buyer'])
  if (guard instanceof NextResponse) return guard

  const { id } = await params
  const orderId = Number(id)
  if (!orderId) return NextResponse.json({ error: 'Неверный id' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const updates: Update[] = Array.isArray(body.updates) ? body.updates : []
  if (updates.length === 0) return NextResponse.json({ ok: true, updated: 0 })

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const now = new Date().toISOString()
  let updated = 0

  // П1: отметка с карточки заказа / QR — такой же факт исполнения, как из очереди цеха.
  // Без этого исполнитель был бы известен только у половины отметок.
  const { data: prof } = await supabase.from('users').select('name').eq('id', user.id).maybeSingle()
  const actor = { id: user.id, name: actorName((prof as { name: string | null } | null)?.name, user.email) }

  // Материал-гейт для резки: если среди updates есть закрытие cutting, проверяем материал (один раз).
  const cuttingDone = updates.some(u => u?.stage_key === 'cutting' && u.action === 'done')
  let cuttingBlocked = false
  if (cuttingDone && body.force !== true) {
    const { data: pos } = await svc.from('purchase_orders').select('b2b_order_ids,status').overlaps('b2b_order_ids', [orderId])
    cuttingBlocked = isCuttingBlocked(orderId, (pos ?? []) as { b2b_order_ids: number[] | null; status: string }[])
  }

  const blocked: number[] = []
  const cascaded: CascadedStage[] = []
  const reopened: { item_index: number; stages: string[] }[] = []
  for (const u of updates) {
    // 'problem' — псевдоэтап старой модели, в production_tasks реального stage нет: пропускаем.
    if (!u || u.stage_key === 'problem' || typeof u.item_index !== 'number') continue
    // Резку не закрываем, пока материал не приехал (остальные этапы проходят).
    if (u.stage_key === 'cutting' && u.action === 'done' && cuttingBlocked) { blocked.push(u.item_index); continue }

    const patch: Record<string, unknown> = u.action === 'unset'
      ? { ...UNSET_TASK_PATCH }
      : buildSyncDonePatch(actor, now)

    // При отмене нужен completed_at ДО снятия: по нему опознаётся каскад, вызванный
    // именно этой отметкой (каскад ставит ту же метку времени, что и вызвавшая отметка).
    let prevCompletedAt: string | null = null
    if (u.action === 'unset') {
      const { data: before } = await svc.from('production_tasks')
        .select('completed_at').eq('order_id', orderId)
        .eq('item_index', u.item_index).eq('stage_key', u.stage_key).maybeSingle()
      prevCompletedAt = (before as { completed_at: string | null } | null)?.completed_at ?? null
    }

    const { data, error } = await svc
      .from('production_tasks')
      .update(patch)
      .eq('order_id', orderId)
      .eq('item_index', u.item_index)
      .eq('stage_key', u.stage_key)
      .select('id, sequence_order')

    if (!error && data) updated += data.length

    // Снятие отметки трогало только СВОЮ задачу: этапы, закрытые каскадом от неё, оставались
    // закрытыми, и заказ показывал «сделано» там, где отметку уже сняли. Возвращаем их тоже.
    if (u.action === 'unset' && !error) {
      const back = await reverseCascade(svc, orderId, u.item_index, prevCompletedAt)
      if (back.length) reopened.push({ item_index: u.item_index, stages: back })
    }

    // Каскад: закрытый этап означает, что все предыдущие этапы детали пройдены.
    const seq = (data?.[0] as { sequence_order?: number } | undefined)?.sequence_order
    if (u.action === 'done' && typeof seq === 'number') {
      const keys = await cascadePriorStages(svc, orderId, u.item_index, seq, now)
      for (const k of keys) cascaded.push({ item_index: u.item_index, stage_key: k })
    }
  }

  // Каскадно закрытые этапы дописываем в notes.detail_stages — иначе на старых
  // экранах они остались бы неотмеченными (клиент записал только свой этап).
  // АТОМАРНО (mark_detail_stages) — без гонки на перезаписи всего notes (причина №2).
  if (cascaded.length > 0) {
    const updates = cascaded.map(c => ({
      item: String(c.item_index), stage: c.stage_key,
      entry: { status: 'done', updated_at: now, updated_by: user.id, updated_by_email: user.email ?? undefined, auto: true },
    }))
    await svc.rpc('mark_detail_stages', { p_order_id: orderId, p_updates: updates })
  }

  // Третье зеркало: закрытые этапы (все позиции) → order-level notes.stages для /b2b-orders/Сводки
  await mirrorOrderStages(svc, orderId)

  return NextResponse.json({
    ok: true, updated, cascaded: cascaded.length,
    reopened: reopened.length ? reopened : undefined,
    blocked: blocked.length ? blocked : undefined,
  })
}
