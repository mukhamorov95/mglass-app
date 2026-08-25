import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { notifyAdmins } from '@/lib/telegram'
import { pushNotification } from '@/lib/partnerNotify'
import { resolvePartnerClient } from '@/lib/partnerClient'

// A3: партнёр согласует чертёж (или отправляет на доработку) прямо в кабинете.
// Строго по своему заказу. Решение кладём в notes.drawing_approval; менеджеру —
// сигнал в Telegram, партнёру — запись в колокольчик. Производство ориентируется
// на этот статус (запуск до согласования — на усмотрение менеджера).

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const oid = Number(id)
  if (!oid) return NextResponse.json({ error: 'Плохой id' }, { status: 400 })

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const client = await resolvePartnerClient<{ id: number; name: string }>(svc, user.id, 'id,name')
  if (!client) return NextResponse.json({ error: 'Аккаунт не привязан' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const decision = body?.decision === 'rework' ? 'rework' : body?.decision === 'approve' ? 'approve' : null
  if (!decision) return NextResponse.json({ error: 'Нужно решение' }, { status: 400 })
  const comment = typeof body?.comment === 'string' ? body.comment.trim().slice(0, 1000) : ''
  if (decision === 'rework' && !comment) return NextResponse.json({ error: 'Опишите, что доработать' }, { status: 400 })

  const { data: order } = await svc.from('b2b_orders').select('id,client_id,custom_number,notes').eq('id', oid).maybeSingle()
  if (!order || order.client_id !== client.id) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 })

  let notes: Record<string, unknown> = {}
  try { notes = order.notes ? JSON.parse(order.notes as string) : {} } catch {}
  if (!notes.drawing_url) return NextResponse.json({ error: 'Чертёж ещё не готов' }, { status: 409 })

  notes.drawing_approval = {
    status: decision === 'approve' ? 'approved' : 'rework',
    comment: comment || null,
    at: new Date().toISOString(),
    by: 'partner',
  }
  const { error } = await svc.from('b2b_orders').update({ notes: JSON.stringify(notes), updated_at: new Date().toISOString() }).eq('id', oid)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const number = (order.custom_number as string | null)?.trim() || `#${oid}`
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
  await notifyAdmins(
    (decision === 'approve'
      ? `✅ <b>Чертёж согласован</b>\n${client.name} согласовал чертёж заказа ${number}.`
      : `✎ <b>Чертёж на доработку</b>\n${client.name} по заказу ${number}: ${comment}`) +
    (base ? `\n${base}/b2b-quotes` : ''),
  ).catch(() => {})

  await pushNotification(svc, {
    clientId: client.id, orderId: oid, kind: decision === 'approve' ? 'drawing_approved' : 'drawing_rework',
    title: decision === 'approve' ? `Чертёж согласован · ${number}` : `Чертёж отправлен на доработку · ${number}`,
    body: decision === 'approve' ? 'Спасибо! Запускаем в производство.' : (comment || undefined),
    link: `/partner/order/${oid}`,
  }).catch(() => {})

  return NextResponse.json({ ok: true, status: notes.drawing_approval })
}
