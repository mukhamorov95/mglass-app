import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { resolvePartnerClient } from '@/lib/partnerClient'
import { notifyAdmins } from '@/lib/telegram'
import { pushNotification } from '@/lib/partnerNotify'

// A17: гарантия/сервис — заявки на рекламацию. GET — свои заявки. POST — создать
// по своему заказу (тип + описание). Менеджеру сигнал в Telegram, партнёру запись
// в колокольчик. Статус ведёт менеджер (партнёр видит на чтение).

const KINDS = new Set(['boy', 'skol', 'mismatch', 'hardware', 'other'])
const KIND_LABEL: Record<string, string> = {
  boy: 'Бой / трещина', skol: 'Скол / царапина', mismatch: 'Не подошло по размеру',
  hardware: 'Проблема с фурнитурой', other: 'Другое',
}

function svcClient() {
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  const svc = svcClient()
  const client = await resolvePartnerClient<{ id: number }>(svc, user.id)
  if (!client) return NextResponse.json({ linked: false, claims: [] })

  const { data } = await svc.from('partner_claims')
    .select('id,order_id,kind,description,status,resolution,created_at,resolved_at')
    .eq('client_id', client.id).order('created_at', { ascending: false }).limit(100)

  // Номера заказов для отображения (по своим заказам).
  const orderIds = [...new Set((data ?? []).map(c => c.order_id).filter(Boolean))] as number[]
  let numbers: Record<number, string> = {}
  if (orderIds.length) {
    const { data: os } = await svc.from('b2b_orders').select('id,custom_number').in('id', orderIds)
    numbers = Object.fromEntries((os ?? []).map(o => [o.id as number, (o.custom_number as string | null)?.trim() || `#${o.id}`]))
  }
  const claims = (data ?? []).map(c => ({ ...c, kindLabel: KIND_LABEL[c.kind] ?? c.kind, orderNumber: c.order_id ? (numbers[c.order_id as number] ?? `#${c.order_id}`) : null }))
  return NextResponse.json({ linked: true, claims })
}

export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  const svc = svcClient()
  const client = await resolvePartnerClient<{ id: number; name: string }>(svc, user.id, 'id,name')
  if (!client) return NextResponse.json({ error: 'Аккаунт не привязан' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const kind = KINDS.has(body?.kind) ? String(body.kind) : null
  const description = typeof body?.description === 'string' ? body.description.trim().slice(0, 2000) : ''
  if (!kind) return NextResponse.json({ error: 'Выберите тип проблемы' }, { status: 400 })
  if (!description) return NextResponse.json({ error: 'Опишите проблему' }, { status: 400 })

  // Заказ (если указан) — строго свой.
  let orderId: number | null = null
  if (body?.orderId) {
    const oid = Number(body.orderId)
    const { data: order } = await svc.from('b2b_orders').select('id,client_id').eq('id', oid).maybeSingle()
    if (!order || order.client_id !== client.id) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 })
    orderId = oid
  }

  const { data: ins, error } = await svc.from('partner_claims')
    .insert({ client_id: client.id, order_id: orderId, kind, description, created_by: user.id })
    .select('id').maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
  await notifyAdmins(
    `⚠️ <b>Рекламация от партнёра</b>\n${client.name}${orderId ? ` · заказ #${orderId}` : ''}\n${KIND_LABEL[kind]}: ${description}` +
    (base ? `\n${base}/b2b-quotes` : ''),
  ).catch(() => {})
  await pushNotification(svc, {
    clientId: client.id, orderId: orderId ?? undefined, kind: 'claim',
    title: 'Заявка по гарантии принята', body: 'Менеджер M-Glass рассмотрит обращение и свяжется с вами.',
    link: '/partner/claims',
  }).catch(() => {})

  return NextResponse.json({ ok: true, id: ins?.id })
}
