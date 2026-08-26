import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/apiAuth'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { parseNotes } from '@/lib/b2b/publicQuote'
import type { PriceApproval } from '@/lib/b2b/priceOverride'

// А11: владелец согласовывает или отклоняет цену с тонкой маржой. Цену не меняем —
// решение только снимает пометку и остаётся в истории. Отклонение это сигнал
// менеджеру пересобрать цену, а не автоматический откат: откатывать чужую
// договорённость с клиентом молча нельзя.

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard

  const { id } = await params
  const orderId = Number(id)
  if (!Number.isFinite(orderId)) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const resolution = body?.resolution === 'approved' ? 'approved' : body?.resolution === 'rejected' ? 'rejected' : null
  if (!resolution) return NextResponse.json({ error: 'Нужно решение' }, { status: 400 })
  const comment = typeof body?.comment === 'string' ? body.comment.slice(0, 500).trim() || null : null

  const sb = await createServerClient()
  const { data: order } = await sb.from('b2b_orders').select('id, notes').eq('id', orderId).maybeSingle()
  if (!order) return NextResponse.json({ error: 'Просчёт не найден' }, { status: 404 })

  const notes = parseNotes(order.notes as string | null)
  const approval = notes.price_approval as PriceApproval | undefined
  if (!approval?.needed) return NextResponse.json({ error: 'Согласование не требуется' }, { status: 409 })

  const { data: { user } } = await sb.auth.getUser()
  let name: string | null = null
  if (user?.id) {
    const { data: prof } = await sb.from('users').select('name').eq('id', user.id).maybeSingle()
    name = (prof?.name as string | null) ?? user.email ?? null
  }

  const next: PriceApproval = {
    ...approval,
    needed: false,
    resolution,
    resolved_by: user?.id ?? null,
    resolved_by_name: name,
    resolved_at: new Date().toISOString(),
    comment,
  }
  // notes — точечным патчем своего ключа price_approval, а не целой записью:
  // иначе оплата/доставка/этапы, попавшие в notes между чтением и записью, были
  // бы затёрты. Патч зовём сервис-клиентом (гейт RPC), колонки авторства — sb.
  const svc = createServiceClient()
  await svc.rpc('patch_order_notes_shallow', { p_order_id: orderId, p_patch: { price_approval: next } })
  const { error } = await sb.from('b2b_orders')
    .update({
      updated_by_user_id: user?.id ?? null,
      updated_by_name: name,
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, approval: next })
}
