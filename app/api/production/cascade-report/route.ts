import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { requireRole } from '@/lib/apiAuth'

export const dynamic = 'force-dynamic'

// Сколько изделий закрылось БЕЗ живой отметки — каскадом, когда кто-то отметил
// свой этап дальше по маршруту. Это не обвинение: физически работа сделана,
// иначе изделие не упаковали бы. Но выработка станции не засчитана, и цех не
// видит, где заказ стоял на самом деле.
//
// completed_by у таких задач пуст намеренно; инициатор пишется отдельно
// (auto_closed_by), см. lib/productionCascade.ts.

const SHOP_ROLES = ['production', 'admin', 'ceo', 'buyer'] as const

type Row = {
  stage_key: string
  auto_closed_by_name: string | null
  auto_closed_from: string | null
  order_id: number
  item_index: number
  completed_at: string | null
}

export async function GET(req: NextRequest) {
  const guard = await requireRole([...SHOP_ROLES])
  if (guard instanceof NextResponse) return guard

  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get('days')) || 30, 1), 365)
  const since = new Date(Date.now() - days * 86400_000).toISOString()

  const svc = createServiceClient()
  const [{ data: autoRows }, { data: liveRows }] = await Promise.all([
    svc.from('production_tasks')
      .select('stage_key, auto_closed_by_name, auto_closed_from, order_id, item_index, completed_at')
      .eq('auto_closed', true).eq('status', 'done').gte('completed_at', since),
    svc.from('production_tasks')
      .select('stage_key, completed_by_name')
      .eq('status', 'done').gte('completed_at', since)
      .or('auto_closed.is.null,auto_closed.eq.false'),
  ])

  const auto = (autoRows ?? []) as Row[]
  const live = (liveRows ?? []) as { stage_key: string; completed_by_name: string | null }[]

  // По станциям: сколько закрыто живьём, сколько каскадом.
  const byStage = new Map<string, { live: number; auto: number }>()
  for (const r of live) {
    const s = byStage.get(r.stage_key) ?? { live: 0, auto: 0 }
    s.live++; byStage.set(r.stage_key, s)
  }
  for (const r of auto) {
    const s = byStage.get(r.stage_key) ?? { live: 0, auto: 0 }
    s.auto++; byStage.set(r.stage_key, s)
  }

  // Кто своей отметкой закрыл чужие этапы и какие.
  const byActor = new Map<string, Map<string, { items: number; orders: Set<number> }>>()
  for (const r of auto) {
    const who = r.auto_closed_by_name ?? '— не определён'
    const stages = byActor.get(who) ?? new Map()
    const cell = stages.get(r.stage_key) ?? { items: 0, orders: new Set<number>() }
    cell.items++; cell.orders.add(r.order_id)
    stages.set(r.stage_key, cell); byActor.set(who, stages)
  }

  return NextResponse.json({
    days,
    total: auto.length,
    stages: [...byStage].map(([stage, v]) => ({
      stage, live: v.live, auto: v.auto,
      pct: v.live + v.auto > 0 ? Math.round(100 * v.auto / (v.live + v.auto)) : 0,
    })).sort((a, b) => (b.auto + b.live) - (a.auto + a.live)),
    actors: [...byActor].map(([name, stages]) => ({
      name,
      total: [...stages.values()].reduce((s, c) => s + c.items, 0),
      stages: [...stages].map(([stage, c]) => ({ stage, items: c.items, orders: c.orders.size }))
        .sort((a, b) => b.items - a.items),
    })).sort((a, b) => b.total - a.total),
  })
}
