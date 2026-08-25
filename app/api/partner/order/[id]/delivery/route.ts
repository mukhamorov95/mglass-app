import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { notifyAdmins } from '@/lib/telegram'

// A8: партнёр указывает способ получения (самовывоз / доставка) и адрес по своему
// заказу. Пишем в notes.delivery; логистику дальше ведёт менеджер (лист рейса).
// Статус доставки (если проставлен нами) отдаём только на чтение.

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const oid = Number(id)
  if (!oid) return NextResponse.json({ error: 'Плохой id' }, { status: 400 })

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: client } = await svc.from('b2b_clients').select('id,name').eq('user_id', user.id).maybeSingle()
  if (!client) return NextResponse.json({ error: 'Аккаунт не привязан' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const method = body?.method === 'delivery' ? 'delivery' : body?.method === 'pickup' ? 'pickup' : null
  if (!method) return NextResponse.json({ error: 'Выберите способ получения' }, { status: 400 })
  const address = typeof body?.address === 'string' ? body.address.trim().slice(0, 500) : ''
  const comment = typeof body?.comment === 'string' ? body.comment.trim().slice(0, 500) : ''
  if (method === 'delivery' && !address) return NextResponse.json({ error: 'Укажите адрес доставки' }, { status: 400 })

  const { data: order } = await svc.from('b2b_orders').select('id,client_id,custom_number,notes').eq('id', oid).maybeSingle()
  if (!order || order.client_id !== client.id) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 })

  let notes: Record<string, unknown> = {}
  try { notes = order.notes ? JSON.parse(order.notes as string) : {} } catch {}
  const prev = (notes.delivery ?? {}) as Record<string, unknown>
  notes.delivery = {
    method, address: method === 'delivery' ? address : null, comment: comment || null,
    status: prev.status ?? null,   // статус доставки проставляем мы, партнёр не трогает
    at: new Date().toISOString(), by: 'partner',
  }
  const { error } = await svc.from('b2b_orders').update({ notes: JSON.stringify(notes), updated_at: new Date().toISOString() }).eq('id', oid)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const number = (order.custom_number as string | null)?.trim() || `#${oid}`
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
  await notifyAdmins(
    `🚚 <b>Способ получения</b>\n${client.name}, заказ ${number}: ${method === 'delivery' ? `доставка — ${address}` : 'самовывоз'}` +
    (comment ? `\nКомментарий: ${comment}` : '') + (base ? `\n${base}/b2b-quotes` : ''),
  ).catch(() => {})

  return NextResponse.json({ ok: true, delivery: notes.delivery })
}
