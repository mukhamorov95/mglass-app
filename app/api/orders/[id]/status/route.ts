import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { notifyAdmins } from '@/lib/telegram'
import { sendMessage as waSend } from '@/lib/wazzup'
import { isOwnerRole } from '@/lib/getRole'

const CLIENT_MESSAGES: Partial<Record<string, string>> = {
  in_work:   'Ваш заказ принят в производство! Срок изготовления — 7–14 рабочих дней. Как только будет готово — сразу свяжемся с вами.',
  completed: 'Ваш заказ готов! 🎉 Наш менеджер свяжется с вами в ближайшее время для согласования доставки.',
}

async function notifyClient(clientPhone: string | null, orderNumber: string, newStatus: string) {
  const msgText = CLIENT_MESSAGES[newStatus]
  if (!msgText || !clientPhone) return

  const phone = clientPhone.replace(/\D/g, '')
  if (phone.length < 10) return

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  // Try to find existing wazzup channel for this client
  const { data: chat } = await svc
    .from('ai_managed_chats')
    .select('channel_id, chat_type')
    .eq('chat_id', clientPhone)
    .maybeSingle() as { data: { channel_id: string; chat_type: string } | null }

  const channelId = chat?.channel_id ?? process.env.WAZZUP_CHANNEL_ID
  const chatType  = chat?.chat_type  ?? 'whatsapp'

  if (!channelId) return

  try {
    await waSend(channelId, phone, chatType, `Заказ №${orderNumber}: ${msgText}`)
  } catch {
    // Non-critical — don't fail the status change
  }
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  draft:            ['in_work', 'pending_approval', 'cancelled'],
  pending_approval: ['cancelled'],
  approved:         ['in_work', 'cancelled'],
  in_work:          ['completed', 'cancelled'],
  completed:        [],
  cancelled:        [],
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const { data: userRow } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  // Owner tier (admin + ceo) uses service role to update any user's order
  const isOwner = isOwnerRole(userRow?.role)
  const { id } = await params
  const { status: newStatus, notes } = await req.json()

  const client = isOwner
    ? createServiceClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
      )
    : supabase

  const { data: order, error: fetchErr } = await (isOwner
    ? createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    : supabase
  ).from('orders').select('status').eq('id', id).single()

  if (fetchErr || !order) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 })

  const allowed = VALID_TRANSITIONS[order.status] ?? []
  if (!allowed.includes(newStatus)) {
    return NextResponse.json(
      { error: `Переход из "${order.status}" в "${newStatus}" недопустим` },
      { status: 400 },
    )
  }

  const update: Record<string, unknown> = { status: newStatus }
  if (newStatus === 'in_work') update.launched_at = new Date().toISOString()
  if (newStatus === 'completed') update.actual_completion_date = new Date().toISOString()
  if (notes) update.notes = notes

  const { error, data: updatedOrder } = await client
    .from('orders')
    .update(update)
    .eq('id', id)
    .select('number, client_name, client_phone, delivery_address')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  type UpdatedOrder = { number: string; client_name: string; client_phone: string | null; delivery_address: string | null }
  const uo = updatedOrder as UpdatedOrder | null

  // Notify client via WhatsApp
  notifyClient(uo?.client_phone ?? null, uo?.number ?? '', newStatus).catch(() => {})

  // Notify admins when order is completed and has a delivery address
  if (newStatus === 'completed' && updatedOrder?.delivery_address) {
    const o = updatedOrder as UpdatedOrder
    notifyAdmins(
      `🚚 <b>Заказ готов к доставке</b>\n\n` +
      `Заказ: <b>${o.number}</b>\n` +
      `Клиент: ${o.client_name}\n` +
      `Адрес доставки: ${o.delivery_address}`,
    ).catch(() => {})
  }

  return NextResponse.json({ ok: true })
}
