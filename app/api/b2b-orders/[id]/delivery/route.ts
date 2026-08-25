import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { parseNotes } from '@/lib/b2b/publicQuote'
import { createServiceClient } from '@/lib/supabase-service'
import { pushNotification } from '@/lib/partnerNotify'

// А16: логистика отгрузки со стороны менеджера. Партнёр в кабинете выбирает способ
// получения (/api/partner/order/[id]/delivery) — здесь менеджер видит то же поле,
// может уточнить адрес и вести статус: собрана → в пути → вручена.
// Пишем в тот же notes.delivery, чтобы у клиента и у нас была одна запись.

const ALLOWED = ['admin', 'ceo', 'manager', 'commercial', 'buyer', 'production'] as const
const STATUSES = ['packed', 'in_transit', 'delivered'] as const
type Status = typeof STATUSES[number]

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireRole([...ALLOWED])
  if (guard instanceof NextResponse) return guard

  const { id } = await params
  const orderId = Number(id)
  if (!Number.isFinite(orderId)) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const method = body?.method === 'delivery' ? 'delivery' : body?.method === 'pickup' ? 'pickup' : null
  const status: Status | null = STATUSES.includes(body?.status) ? body.status : null
  const address = typeof body?.address === 'string' ? body.address.trim().slice(0, 500) : ''
  const comment = typeof body?.comment === 'string' ? body.comment.trim().slice(0, 500) : ''
  const shipDate = typeof body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : null
  if (!method && !status && !shipDate) return NextResponse.json({ error: 'Нечего сохранять' }, { status: 400 })
  if (method === 'delivery' && !address) return NextResponse.json({ error: 'Укажите адрес доставки' }, { status: 400 })

  const sb = await createServerClient()
  const { data: order } = await sb.from('b2b_orders').select('id, client_id, custom_number, notes').eq('id', orderId).maybeSingle()
  if (!order) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 })

  const { data: { user } } = await sb.auth.getUser()
  let name: string | null = null
  if (user?.id) {
    const { data: prof } = await sb.from('users').select('name').eq('id', user.id).maybeSingle()
    name = (prof?.name as string | null) ?? user.email ?? null
  }

  const notes = parseNotes(order.notes as string | null)
  const prev = (notes.delivery ?? {}) as Record<string, unknown>
  const delivery = {
    ...prev,
    ...(method ? { method, address: method === 'delivery' ? address : null } : {}),
    ...(comment ? { comment } : {}),
    ...(status ? { status } : {}),
    ...(shipDate ? { date: shipDate } : {}),
    at: new Date().toISOString(),
    by: name ?? 'manager',
  }
  // «Вручена» = заказ отгружен: дата уходит в notes.shipped_date, на неё смотрят
  // сроки, УПД и «мой день». Второго источника правды не заводим.
  const shipped = status === 'delivered'
    ? { shipped_date: shipDate ?? new Date().toISOString().slice(0, 10) }
    : {}

  const { error } = await sb.from('b2b_orders').update({
    notes: JSON.stringify({ ...notes, delivery, ...shipped }),
    updated_by_user_id: user?.id ?? null,
    updated_by_name: name,
    updated_at: new Date().toISOString(),
  }).eq('id', orderId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // А20: клиент видит отгрузку в своём кабинете сразу, а не после ночного крона.
  if (status === 'delivered' && order.client_id) {
    try {
      await pushNotification(createServiceClient(), {
        clientId: Number(order.client_id),
        orderId,
        kind: 'shipped',
        title: `Заказ ${(order.custom_number as string | null)?.trim() || `#${orderId}`} отгружен`,
        body: delivery.method === 'delivery' ? `Доставка: ${delivery.address ?? ''}`.trim() : 'Самовывоз',
        link: `/partner/order/${orderId}`,
      })
    } catch { /* уведомление не должно ломать отметку отгрузки */ }
  }

  return NextResponse.json({ ok: true, delivery })
}
