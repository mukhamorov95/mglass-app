import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { requireRole } from '@/lib/apiAuth'
import { actorName, buildTaskUpdate } from '@/lib/production/executor'
import { cascadePriorStages } from '@/lib/productionCascade'
import { consumeCutting, loadCascadedTasks } from '@/lib/production/consumeBridge'
import { mirrorOrderStages } from '@/lib/productionOrderMirror'
import { pickMyStageTasks, type StationTask } from '@/lib/production/completeMyStage'

// «Готово на моей станции» — закрыть СВОЙ этап по всем деталям заказа за одно нажатие.
//
// Кнопка «Всё готово» закрывает заказ целиком и оставлена только упаковщику: он
// последний в маршруте и видит, что заказ собран. Но резчику и полировщику тоже
// незачем жать «Готово» на каждой из пятнадцати деталей — они сделали весь заказ
// разом (запрос владельца 28.08).
//
// Границу задаёт СЕРВЕР по станциям в профиле, а не браузер: так рабочий физически
// не может закрыть чужой этап, даже отправив запрос вручную.

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
      .select('id, item_index, sequence_order, status, started_at, assigned_to, started_by, stage_key, station, rework_count')
      .eq('order_id', orderId),
    supabase.from('users').select('name, production_stations').eq('id', user.id).maybeSingle(),
  ])

  const p = prof as { name: string | null; production_stations: string[] | null } | null
  const stations = p?.production_stations ?? []
  if (stations.length === 0) {
    return NextResponse.json({ error: 'У вас не назначено ни одной станции' }, { status: 403 })
  }

  const mine = pickMyStageTasks((rows ?? []) as StationTask[], stations, user.id)
  if (mine.length === 0) return NextResponse.json({ ok: true, closed: 0, cascaded: 0, already: true })

  const actor = { id: user.id, name: actorName(p?.name, user.email) }
  const now = new Date().toISOString()
  const by = { userId: user.id, name: actor.name ?? undefined }

  let closed = 0
  let cascaded = 0
  for (const t of mine) {
    const { error } = await svc.from('production_tasks')
      .update(buildTaskUpdate('done', actor, t, now))
      .eq('id', t.id)
    if (error) continue
    closed++

    // Каскад закрывает всё, что до моего этапа: этап не бывает сделан раньше предыдущих.
    const keys = await cascadePriorStages(svc, orderId, t.item_index, t.sequence_order, now)
    cascaded += keys.length

    const item = String(t.item_index)
    await svc.rpc('mark_detail_stages', {
      p_order_id: orderId,
      p_updates: [
        { item, stage: t.stage_key, entry: { status: 'done', updated_at: now, updated_by: user.id, updated_by_email: user.email ?? undefined } },
        ...keys.map(k => ({ item, stage: k, entry: { status: 'done', updated_at: now, updated_by: user.id, updated_by_email: user.email ?? undefined, auto: true } })),
      ],
    })

    // Склад: моя отметка (если это резка) и всё, что закрыл каскад.
    await consumeCutting(orderId, [{ item_index: t.item_index, stage_key: t.stage_key, rework_count: t.rework_count ?? 0 }], 'my-stage', by)
    const cascadedTasks = await loadCascadedTasks(svc, orderId, t.item_index, keys)
    await consumeCutting(orderId, cascadedTasks, 'cascade', by)
  }

  await mirrorOrderStages(svc, orderId)

  return NextResponse.json({ ok: true, closed, cascaded })
}
