import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { requireRole } from '@/lib/apiAuth'
import { CASCADE_FROM } from '@/lib/production/managerCascade'
import { closeOpenTasksOnOrderMark } from '@/lib/production/closeOnOrderMark'

// Отметка «Отгружен» — отдельное событие, не этап производства.
//
// Упаковано не значит отгружено: заказ лежит на складе, пока за ним не приедут.
// Иногда днями. Поэтому отдельный экран и отдельная отметка, а не продолжение
// маршрута цеха.
//
// Отгружать может любой из цеха и менеджер (владелец 01.09): чаще это Никита,
// но подходит тот, кто оказался у машины. Ограничивать одним человеком нельзя —
// отметку просто перестанут ставить, как это и случилось в июле.

const SHIP_ROLES = ['production', 'manager', 'admin', 'ceo', 'buyer', 'logist'] as const

export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  const guard = await requireRole([...SHIP_ROLES])
  if (guard instanceof NextResponse) return guard

  const body = await req.json().catch(() => ({}))
  const orderId = Number(body.order_id)
  const undo    = body.undo === true
  if (!orderId) return NextResponse.json({ error: 'Неверный id заказа' }, { status: 400 })

  const svc = createServiceClient()
  const { data: prof } = await supabase.from('users').select('name').eq('id', user.id).maybeSingle()
  const who = (prof as { name: string | null } | null)?.name ?? user.email ?? 'Цех'
  const nowIso = new Date().toISOString()

  // stages лежит внутри notes — точечная запись под блокировкой строки, иначе
  // параллельная отметка этапа в цеху затрёт её целиком.
  const { error } = await svc.rpc('mark_order_stages', {
    p_order_id: orderId,
    p_stages: { shipped: undo ? null : nowIso },
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await svc.from('b2b_orders')
    .update({ updated_by_name: who, updated_at: nowIso })
    .eq('id', orderId)

  // Уехал — значит в цеху по нему делать нечего: открытые задачи закрываем каскадом,
  // как при отметке менеджера (lib/production/managerCascade.ts). Отмена отгрузки
  // задачи не переоткрывает.
  const shop: { closed: number; error?: string } = undo
    ? { closed: 0 }
    : await closeOpenTasksOnOrderMark(svc, orderId, 'shipped', CASCADE_FROM.shipping.shipped, { id: user.id, name: who })
  if (shop.error) console.error(`[ship] shop cascade failed order=${orderId}: ${shop.error}`)

  return NextResponse.json({ ok: true, shipped_at: undo ? null : nowIso, by: who, shop_closed: shop.closed })
}
