import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { paymentsEnabled, verifyWebhook, type PaymentProvider } from '@/lib/payments/provider'

// A2: приём подтверждения оплаты от эквайринга (вебхук). Пока провайдер не подключён —
// 501. Когда подключим: verifyWebhook проверяет подпись, из payload берём orderId,
// помечаем b2b_orders.notes.payment_status='paid' (это же читает карточка заказа и Табло).
// Путь /api/payments/ добавлен в whitelist middleware (без сессии).

export async function POST(req: Request) {
  if (!paymentsEnabled()) return NextResponse.json({ error: 'not configured' }, { status: 501 })
  const provider = process.env.PAYMENT_PROVIDER as PaymentProvider
  const raw = await req.text()
  if (!verifyWebhook(provider, req.headers, raw)) return NextResponse.json({ error: 'bad signature' }, { status: 401 })

  let payload: Record<string, unknown> = {}
  try { payload = JSON.parse(raw) } catch { return NextResponse.json({ error: 'bad body' }, { status: 400 }) }

  // TODO(A2): извлечь orderId и статус из payload конкретного провайдера.
  const orderId = Number((payload.metadata as Record<string, unknown> | undefined)?.orderId ?? payload.orderId)
  if (!orderId) return NextResponse.json({ error: 'no order' }, { status: 400 })

  const svc = createServiceClient()
  const { data: order } = await svc.from('b2b_orders').select('notes').eq('id', orderId).maybeSingle()
  if (!order) return NextResponse.json({ error: 'order not found' }, { status: 404 })
  let notes: Record<string, unknown> = {}
  try { notes = order.notes ? JSON.parse(order.notes as string) : {} } catch {}
  notes.payment_status = 'paid'
  notes.paid_at = new Date().toISOString()
  await svc.from('b2b_orders').update({ notes: JSON.stringify(notes), updated_at: new Date().toISOString() }).eq('id', orderId)
  return NextResponse.json({ ok: true })
}
