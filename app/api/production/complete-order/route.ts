import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { requireRole } from '@/lib/apiAuth'
import { actorName, buildTaskUpdate } from '@/lib/production/executor'
import { pickFinalTasks, type ClosableTask } from '@/lib/production/completeOrder'
import { cascadePriorStages } from '@/lib/productionCascade'
import { mirrorOrderStages } from '@/lib/productionOrderMirror'

// «Всё готово» — закрыть заказ целиком одним нажатием (запрос Никиты с упаковки).
//
// Шлём по одной задаче на деталь — последнюю открытую, — а всё, что до неё, закрывает
// каскад БЕЗ исполнителя. Почему именно так — в lib/production/completeOrder.ts:
// коротко, человеку записывается только то, что он утверждает сам.
//
// Один запрос вместо потока: старая кнопка «Упаковано разом» в /production-app/orders
// слала по запросу на каждую незакрытую задачу — на заказе в 61 задачу это 61 запрос.

const SHOP_ROLES = ['production', 'admin', 'ceo', 'buyer'] as const

export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  const guard = await requireRole([...SHOP_ROLES])
  if (guard instanceof NextResponse) return guard

  const body = await req.json().catch(() => ({}))
  const orderId = Number(body.order_id)
  if (!orderId) return NextResponse.json({ error: 'Неверный id заказа' }, { status: 400 })

  const svc = createServiceClient()
  const [{ data: rows }, { data: prof }] = await Promise.all([
    svc.from('production_tasks')
      .select('id, item_index, sequence_order, status, started_at, assigned_to, started_by, stage_key')
      .eq('order_id', orderId),
    supabase.from('users').select('name').eq('id', user.id).maybeSingle(),
  ])
  const all = (rows ?? []) as (ClosableTask & { started_at: string | null; assigned_to: string | null; started_by: string | null; stage_key: string })[]
  if (all.length === 0) return NextResponse.json({ error: 'По заказу нет задач' }, { status: 404 })

  const actor = { id: user.id, name: actorName((prof as { name: string | null } | null)?.name, user.email) }
  const now = new Date().toISOString()
  const finals = pickFinalTasks(all)
  if (finals.length === 0) return NextResponse.json({ ok: true, closed: 0, cascaded: 0, already: true })

  let cascaded = 0
  for (const f of finals) {
    const snapshot = all.find(t => t.id === f.id)!
    const { error } = await svc.from('production_tasks')
      .update(buildTaskUpdate('done', actor, snapshot, now))
      .eq('id', f.id)
    if (error) continue
    const keys = await cascadePriorStages(svc, orderId, f.item_index, f.sequence_order, now)
    cascaded += keys.length

    // Зеркало прогресса на уровне заказа: отмеченный этап пишем как живую отметку,
    // каскадные — с auto, чтобы старые экраны видели то же самое, что и новая модель.
    const item = String(f.item_index)
    const updates: { item: string; stage: string; entry: Record<string, unknown> }[] = [
      { item, stage: snapshot.stage_key, entry: { status: 'done', updated_at: now, updated_by: user.id, updated_by_email: user.email ?? undefined } },
      ...keys.map(k => ({ item, stage: k, entry: { status: 'done', updated_at: now, updated_by: user.id, updated_by_email: user.email ?? undefined, auto: true } })),
    ]
    await svc.rpc('mark_detail_stages', { p_order_id: orderId, p_updates: updates })
  }

  await mirrorOrderStages(svc, orderId)

  return NextResponse.json({ ok: true, closed: finals.length, cascaded })
}
