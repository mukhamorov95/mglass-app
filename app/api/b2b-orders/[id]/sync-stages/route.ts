import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { mirrorOrderStages } from '@/lib/productionOrderMirror'

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

  for (const u of updates) {
    // 'problem' — псевдоэтап старой модели, в production_tasks реального stage нет: пропускаем.
    if (!u || u.stage_key === 'problem' || typeof u.item_index !== 'number') continue

    const patch: Record<string, unknown> = u.action === 'unset'
      ? { status: 'queued', completed_at: null, started_at: null, problem_at: null, problem_resolved_at: null, problem_reason_code: null, problem_comment: null }
      : { status: 'done', completed_at: now, problem_resolved_at: now }

    const { data, error } = await svc
      .from('production_tasks')
      .update(patch)
      .eq('order_id', orderId)
      .eq('item_index', u.item_index)
      .eq('stage_key', u.stage_key)
      .select('id')

    if (!error && data) updated += data.length
  }

  // Третье зеркало: закрытые этапы (все позиции) → order-level notes.stages для /b2b-orders/Сводки
  await mirrorOrderStages(svc, orderId)

  return NextResponse.json({ ok: true, updated })
}
