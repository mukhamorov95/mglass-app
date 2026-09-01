import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { requireRole } from '@/lib/apiAuth'
import { renumberItem, itemNeedsStage, type ExistingTask } from '@/lib/production/addStage'

// «Добавить свой этап» — рабочий забирает к себе заказ, которого у него нет.
//
// Маршрут строится из признаков просчёта: менеджер не отметил отверстия — задачи
// сверловки не появилось, и Адилет заказ не видит, хотя физически его сверлит.
// 01.09.2026 таких набралось четыре подряд.
//
// Границу считает СЕРВЕР по станциям профиля: добавить можно только свой этап.
// Чужой — нет, даже запросом вручную.

const SHOP_ROLES = ['production', 'admin', 'ceo', 'buyer'] as const

type Task = { id: number; item_index: number; stage_key: string; sequence_order: number; layer: number | null }

export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  const guard = await requireRole([...SHOP_ROLES])
  if (guard instanceof NextResponse) return guard

  const body = await req.json().catch(() => ({}))
  const orderId = Number(body.order_id)
  const stage   = String(body.stage ?? '')
  if (!orderId || !stage) return NextResponse.json({ error: 'Нужны заказ и этап' }, { status: 400 })

  const svc = createServiceClient()
  const [{ data: prof }, { data: rows }] = await Promise.all([
    supabase.from('users').select('production_stations, role').eq('id', user.id).maybeSingle(),
    svc.from('production_tasks').select('id, item_index, stage_key, sequence_order, layer').eq('order_id', orderId),
  ])

  const p = prof as { production_stations: string[] | null; role: string | null } | null
  const stations = p?.production_stations ?? []
  const isOwner = p?.role === 'admin' || p?.role === 'ceo'
  if (!isOwner && !stations.includes(stage)) {
    return NextResponse.json({ error: 'Можно добавить только свой этап' }, { status: 403 })
  }

  const tasks = (rows ?? []) as Task[]
  if (tasks.length === 0) return NextResponse.json({ error: 'Заказ не запущен в работу' }, { status: 400 })

  const items = [...new Set(tasks.map(t => t.item_index))].sort((a, b) => a - b)
  const needed = items.filter(i => itemNeedsStage(tasks as ExistingTask[], i, stage))
  if (needed.length === 0) return NextResponse.json({ ok: true, added: 0, already: true })

  let added = 0
  for (const itemIndex of needed) {
    const mine = tasks.filter(t => t.item_index === itemIndex)
    const layer = mine[0]?.layer ?? 1
    const plan = renumberItem(mine as ExistingTask[], stage)

    // Сначала вставляем задачу, потом перенумеровываем ВСЕ этапы детали: у
    // существующих номера присвоены без нового этапа, и он получил бы чужой номер.
    const { data: ins } = await svc.from('production_tasks')
      .insert({
        order_id: orderId, item_index: itemIndex, stage_key: stage, station: stage,
        sequence_order: plan.find(x => x.stage_key === stage)!.sequence_order,
        status: 'queued', layer, layer_note: null, production_day: null,
      })
      .select('id, item_index, stage_key, sequence_order, layer')
      .single()
    if (!ins) continue
    added++

    const all = [...mine, ins as Task]
    for (const step of plan) {
      const row = all.find(t => t.stage_key === step.stage_key)
      if (row && row.sequence_order !== step.sequence_order) {
        await svc.from('production_tasks').update({ sequence_order: step.sequence_order }).eq('id', row.id)
        row.sequence_order = step.sequence_order
      }
    }

    // Цепочка «кто кого ждёт» — заново по новым номерам, иначе новый этап никого
    // не ждёт, а следующий за ним ждёт того, кто теперь стоит раньше.
    const ordered = [...all].sort((a, b) => a.sequence_order - b.sequence_order)
    for (let i = 0; i < ordered.length; i++) {
      await svc.from('production_tasks')
        .update({ blocked_by_task_id: i === 0 ? null : ordered[i - 1].id })
        .eq('id', ordered[i].id)
    }
  }

  return NextResponse.json({ ok: true, added, items: needed.length })
}
