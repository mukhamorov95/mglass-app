import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { getSessionUser } from '@/lib/getRole'
import { createServiceClient } from '@/lib/supabase-service'
import { mskDayKey } from '@/lib/time'
import { loadOrders, writeSupply } from '@/lib/purchasing/server'

export const dynamic = 'force-dynamic'

// «Пришёл» по заказу поставщику: запись переезжает в колонку канбана «Материал
// забран», а заказы из неё — в «есть» (статус «принят»). Трогаем только заказы,
// которые стоят «заказан»: если кто-то уже поставил «есть» или вернул «не заказан»,
// его решение не перезаписываем.

const ROLES = ['admin', 'ceo', 'buyer'] as const

export async function POST(req: NextRequest) {
  const guard = await requireRole([...ROLES])
  if (guard instanceof NextResponse) return guard
  const user = await getSessionUser()

  const b = await req.json().catch(() => null) as { purchaseOrderId?: unknown } | null
  const poId = Number(b?.purchaseOrderId)
  if (!Number.isFinite(poId)) return NextResponse.json({ error: 'Нужен id заказа поставщику' }, { status: 400 })

  const svc = createServiceClient()
  const { data: po, error } = await svc.from('purchase_orders')
    .select('id, status, b2b_order_ids').eq('id', poId).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!po) return NextResponse.json({ error: 'Заказ поставщику не найден' }, { status: 404 })

  const today = mskDayKey()
  const { error: upErr } = await svc.from('purchase_orders')
    .update({ status: 'picked_up', received_date: today, updated_at: new Date().toISOString() })
    .eq('id', poId)
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  const ids = ((po.b2b_order_ids ?? []) as number[]).map(Number).filter(Number.isFinite)
  if (!ids.length) return NextResponse.json({ ok: true, marked: [], skipped: [], failed: [] })

  let orders
  try { orders = await loadOrders(svc, ids) } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }) }
  const waiting = orders.filter(o => o.state === 'ordered')
  const skipped = orders.filter(o => o.state !== 'ordered').map(o => ({ id: o.id, number: o.number, state: o.state }))
  const res = await writeSupply(svc, waiting, 'in_stock', { today, userId: user?.id ?? null, fromPurchase: true })
  return NextResponse.json({ ok: res.failed.length === 0, marked: res.done, failed: res.failed, skipped })
}
