import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { requireRole } from '@/lib/apiAuth'

// Отметка Валерии: чертежи по заказу распечатаны / нет. Хранится в notes.docs_printed.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Внутреннее действие — партнёр и внешние роли сюда не ходят.
  const guard = await requireRole(['production', 'admin', 'ceo', 'buyer', 'manager', 'commercial'])
  if (guard instanceof NextResponse) return guard

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const printed = !!body.printed

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: order } = await svc.from('b2b_orders').select('notes').eq('id', id).single()
  if (!order) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 })

  // notes ТОЧЕЧНО, а не целиком: плоские ключи docs_printed* — shallow-patch;
  // вложенный stages.printed — mark_order_stages (shallow заменил бы весь stages
  // и вернул клоббер этапов из #274). Иначе оплата/доставка/этапы, попавшие в
  // notes между чтением и записью, были бы затёрты.
  const nowIso = new Date().toISOString()
  const orderId = Number(id)
  await svc.rpc('patch_order_notes_shallow', { p_order_id: orderId, p_patch: {
    docs_printed: printed,
    docs_printed_at: printed ? nowIso : null,
    docs_printed_by: printed ? (user.email ?? user.id) : null,
  } })
  const { error } = await svc.rpc('mark_order_stages', { p_order_id: orderId, p_stages: { printed: printed ? nowIso : null } })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
