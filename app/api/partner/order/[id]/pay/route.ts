import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { resolvePartnerClient } from '@/lib/partnerClient'
import { createPaymentLink, paymentsEnabled } from '@/lib/payments/provider'

// A2: инициировать онлайн-оплату по своему заказу. Пока эквайринг не подключён —
// 501 «оплата онлайн ещё не подключена» (кнопка в кабинете и так скрыта). Когда
// подключим — возвращаем URL платёжной страницы, клиент редиректится туда.

function parseNotes(n: unknown): Record<string, unknown> {
  if (!n) return {}
  if (typeof n === 'object') return n as Record<string, unknown>
  try { const p = JSON.parse(String(n)); return typeof p === 'object' && p ? p as Record<string, unknown> : {} } catch { return {} }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const oid = Number(id)
  if (!oid) return NextResponse.json({ error: 'Плохой id' }, { status: 400 })
  if (!paymentsEnabled()) return NextResponse.json({ error: 'Оплата онлайн ещё не подключена' }, { status: 501 })

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const client = await resolvePartnerClient<{ id: number; name: string }>(svc, user.id, 'id,name')
  if (!client) return NextResponse.json({ error: 'Аккаунт не привязан' }, { status: 403 })

  const { data: order } = await svc.from('b2b_orders')
    .select('id,client_id,custom_number,total_after_discount,total_sale_inc_vat,notes').eq('id', oid).maybeSingle()
  if (!order || order.client_id !== client.id) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 })

  const pn = parseNotes(order.notes)
  if (pn.payment_status === 'paid') return NextResponse.json({ error: 'Заказ уже оплачен' }, { status: 409 })

  const amount = Number(order.total_after_discount ?? order.total_sale_inc_vat ?? 0) || 0
  if (amount <= 0) return NextResponse.json({ error: 'Нулевая сумма' }, { status: 400 })
  const number = (order.custom_number as string | null)?.trim() || `#${oid}`
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin).replace(/\/$/, '')

  const link = await createPaymentLink({
    orderId: oid, amount, description: `Оплата заказа ${number} · M-Glass`,
    returnUrl: `${base}/partner/order/${oid}`,
  })
  if (!link) return NextResponse.json({ error: 'Оплата онлайн ещё не подключена' }, { status: 501 })
  return NextResponse.json({ ok: true, url: link.url })
}
