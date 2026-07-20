import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { mirrorOrderStages } from '@/lib/productionOrderMirror'
import { isCuttingBlocked } from '@/lib/materialGate'
import { cascadePriorStages, type CascadedStage } from '@/lib/productionCascade'

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

  const { id } = await params
  const orderId = Number(id)
  if (!orderId) return NextResponse.json({ error: 'Неверный id' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const updates: Update[] = Array.isArray(body.updates) ? body.updates : []
  if (updates.length === 0) return NextResponse.json({ ok: true, updated: 0 })

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const now = new Date().toISOString()
  let updated = 0

  // Материал-гейт для резки: если среди updates есть закрытие cutting, проверяем материал (один раз).
  const cuttingDone = updates.some(u => u?.stage_key === 'cutting' && u.action === 'done')
  let cuttingBlocked = false
  if (cuttingDone && body.force !== true) {
    const { data: pos } = await svc.from('purchase_orders').select('b2b_order_ids,status').overlaps('b2b_order_ids', [orderId])
    cuttingBlocked = isCuttingBlocked(orderId, (pos ?? []) as { b2b_order_ids: number[] | null; status: string }[])
  }

  const blocked: number[] = []
  const cascaded: CascadedStage[] = []
  for (const u of updates) {
    // 'problem' — псевдоэтап старой модели, в production_tasks реального stage нет: пропускаем.
    if (!u || u.stage_key === 'problem' || typeof u.item_index !== 'number') continue
    // Резку не закрываем, пока материал не приехал (остальные этапы проходят).
    if (u.stage_key === 'cutting' && u.action === 'done' && cuttingBlocked) { blocked.push(u.item_index); continue }

    const patch: Record<string, unknown> = u.action === 'unset'
      ? { status: 'queued', completed_at: null, started_at: null, problem_at: null, problem_resolved_at: null, problem_reason_code: null, problem_comment: null }
      : { status: 'done', completed_at: now, problem_resolved_at: now }

    const { data, error } = await svc
      .from('production_tasks')
      .update(patch)
      .eq('order_id', orderId)
      .eq('item_index', u.item_index)
      .eq('stage_key', u.stage_key)
      .select('id, sequence_order')

    if (!error && data) updated += data.length

    // Каскад: закрытый этап означает, что все предыдущие этапы детали пройдены.
    const seq = (data?.[0] as { sequence_order?: number } | undefined)?.sequence_order
    if (u.action === 'done' && typeof seq === 'number') {
      const keys = await cascadePriorStages(svc, orderId, u.item_index, seq, now)
      for (const k of keys) cascaded.push({ item_index: u.item_index, stage_key: k })
    }
  }

  // Каскадно закрытые этапы дописываем в notes.detail_stages — иначе на старых
  // экранах они остались бы неотмеченными (клиент записал только свой этап).
  if (cascaded.length > 0) {
    const { data: ord } = await svc.from('b2b_orders').select('notes').eq('id', orderId).single()
    if (ord) {
      const notes = typeof ord.notes === 'string'
        ? (() => { try { return JSON.parse(ord.notes) } catch { return {} } })()
        : (ord.notes ?? {})
      const ds = (notes.detail_stages ?? {}) as Record<string, Record<string, unknown>>
      for (const c of cascaded) {
        const key = String(c.item_index)
        ds[key] = ds[key] ?? {}
        if ((ds[key][c.stage_key] as { status?: string } | undefined)?.status === 'done') continue
        ds[key][c.stage_key] = { status: 'done', updated_at: now, updated_by: user.id, updated_by_email: user.email ?? undefined, auto: true }
      }
      notes.detail_stages = ds
      await svc.from('b2b_orders').update({ notes: JSON.stringify(notes) }).eq('id', orderId)
    }
  }

  // Третье зеркало: закрытые этапы (все позиции) → order-level notes.stages для /b2b-orders/Сводки
  await mirrorOrderStages(svc, orderId)

  return NextResponse.json({ ok: true, updated, cascaded: cascaded.length, blocked: blocked.length ? blocked : undefined })
}
