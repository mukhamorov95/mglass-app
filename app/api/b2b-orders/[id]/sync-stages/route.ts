import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { requireRole } from '@/lib/apiAuth'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { actorName } from '@/lib/production/executor'
import { applyStageUpdates, type StageUpdate } from '@/lib/production/syncStages'

// Обратное зеркало: отметка этапа со «старых» экранов (orders/[id], /p/o) → production_tasks.
// Прямое зеркало (production_tasks → notes.detail_stages) живёт в /api/production-tasks/[id].
// Здесь замыкаем вторую сторону, чтобы обе модели прогресса были согласованы.
// Best-effort: у исторических заказов строк production_tasks нет — тогда просто ничего не трогаем.

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
  const updates: StageUpdate[] = Array.isArray(body.updates) ? body.updates : []
  if (updates.length === 0) return NextResponse.json({ ok: true, updated: 0 })

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  // П1: отметка с карточки заказа / QR — такой же факт исполнения, как из очереди цеха.
  // Без этого исполнитель был бы известен только у половины отметок.
  const { data: prof } = await supabase.from('users').select('name').eq('id', user.id).maybeSingle()
  const actor = { id: user.id, name: actorName((prof as { name: string | null } | null)?.name, user.email), email: user.email }
  const { updated, failed, cascaded, reopened } = await applyStageUpdates(svc, orderId, updates, actor)

  // Не записалось хоть что-то — отвечаем ошибкой: карточка заказа покажет, что в очередь
  // цеха отметка не дошла, а не «Сохранено».
  if (failed.length) {
    return NextResponse.json({ error: `В очередь цеха не записалось: ${failed.join('; ')}`, updated, failed }, { status: 500 })
  }
  return NextResponse.json({
    ok: true, updated, cascaded: cascaded.length,
    reopened: reopened.length ? reopened : undefined,
  })
}
