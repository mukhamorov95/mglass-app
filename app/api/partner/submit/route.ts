import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { reviewPartnerQuote, type ReviewItem } from '@/lib/ai-tools/reviewPartnerQuote'
import { notifyAdmins } from '@/lib/telegram'

// Партнёр отправляет свой просчёт в заявку (на проверку менеджеру).
// Просчёт → status='pending_approval'. Только свой просчёт, только если не запущен.
// Заодно прогоняем AI-анализ логики (best-effort) — результат кладём в notes.ai_review
// для менеджера. Цену AI не трогает (её считает наш движок).

export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: client } = await svc.from('b2b_clients').select('id,name').eq('user_id', user.id).maybeSingle()
  if (!client) return NextResponse.json({ error: 'Аккаунт не привязан' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const quoteId = Number(body?.quoteId)
  if (!quoteId) return NextResponse.json({ error: 'Не указан просчёт' }, { status: 400 })

  const { data: order } = await svc.from('b2b_orders')
    .select('id,client_id,launched_at,notes,items').eq('id', quoteId).maybeSingle()
  if (!order || order.client_id !== client.id) return NextResponse.json({ error: 'Просчёт не найден' }, { status: 404 })
  if (order.launched_at) return NextResponse.json({ error: 'Заказ уже в работе' }, { status: 400 })

  let notes: Record<string, unknown> = {}
  try { notes = order.notes ? JSON.parse(order.notes as string) : {} } catch {}
  if (notes.status === 'pending_approval') return NextResponse.json({ ok: true, already: true })

  const history = Array.isArray(notes.status_history) ? notes.status_history : []
  history.push({ from: (notes.status as string) || 'quote', to: 'pending_approval', date: new Date().toISOString(), by: 'partner' })
  notes.status = 'pending_approval'
  notes.status_history = history
  notes.submitted_by_partner_at = new Date().toISOString()

  // AI-проверка логики просчёта — best-effort, не роняет отправку.
  try {
    const rawItems = Array.isArray(order.items) ? (order.items as Record<string, unknown>[]) : []
    const reviewItems: ReviewItem[] = rawItems.map(it => ({
      material: String(it.materialName ?? ''), thickness: Number(it.thickness) || 0,
      width: Number(it.width) || 0, height: Number(it.height) || 0, quantity: Number(it.quantity) || 0,
      hasTempering: !!it.hasTempering, hasFacet: !!it.hasFacet, hasHoles: !!it.hasHoles, shape: String(it.shape ?? 'rect'),
    }))
    const review = await reviewPartnerQuote(reviewItems)
    if (review.summary || review.issues.length) notes.ai_review = review
  } catch { /* AI недоступен — заявка всё равно уходит */ }

  const { error } = await svc.from('b2b_orders').update({ notes: JSON.stringify(notes), updated_at: new Date().toISOString() }).eq('id', quoteId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Аудит: партнёр отправил просчёт в работу (best-effort, не роняет ответ).
  await svc.from('security_events').insert({
    user_id: user.id, event: 'partner_quote_submitted',
    meta: { orderId: quoteId, clientId: client.id },
  }).then(() => {}, () => {})

  // Уведомление менеджерам/владельцу в Telegram (best-effort).
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
  await notifyAdmins(
    `🧾 <b>Новая заявка от партнёра</b>\n${client.name} отправил просчёт №${quoteId} в работу.` +
    (base ? `\n${base}/b2b-quotes` : ''),
  ).catch(() => {})

  return NextResponse.json({ ok: true })
}
