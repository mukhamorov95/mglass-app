import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { reviewPartnerQuote, type ReviewItem } from '@/lib/ai-tools/reviewPartnerQuote'
import { notifyAdmins } from '@/lib/telegram'
import { pushNotification } from '@/lib/partnerNotify'
import { resolvePartnerClient } from '@/lib/partnerClient'
import { appUrl } from '@/lib/appUrl'
import { appendTo, parseOrderNotes } from '@/lib/b2b/orderNotes'

// Партнёр отправляет свой просчёт в заявку (на проверку менеджеру).
// Просчёт → status='pending_approval'. Только свой просчёт, только если не запущен.
// Заодно прогоняем AI-анализ логики (best-effort) — результат кладём в notes.ai_review
// для менеджера. Цену AI не трогает (её считает наш движок).

export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const client = await resolvePartnerClient<{ id: number; name: string }>(svc, user.id, 'id,name')
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

  // AI-проверка логики просчёта — best-effort, не роняет отправку. Идёт секунды, поэтому
  // notes после неё читаем заново и пишем только свои ключи: целая запись из чтения до
  // вызова модели стирала то, что менеджер успел записать за это время.
  let aiReview: unknown = undefined
  try {
    const rawItems = Array.isArray(order.items) ? (order.items as Record<string, unknown>[]) : []
    const reviewItems: ReviewItem[] = rawItems.map(it => ({
      material: String(it.materialName ?? ''), thickness: Number(it.thickness) || 0,
      width: Number(it.width) || 0, height: Number(it.height) || 0, quantity: Number(it.quantity) || 0,
      hasTempering: !!it.hasTempering, hasFacet: !!it.hasFacet, hasHoles: !!it.hasHoles, shape: String(it.shape ?? 'rect'),
    }))
    const review = await reviewPartnerQuote(reviewItems)
    if (review.summary || review.issues.length) aiReview = review
  } catch { /* AI недоступен — заявка всё равно уходит */ }

  const { data: freshRow, error: freshErr } = await svc.from('b2b_orders').select('notes').eq('id', quoteId).maybeSingle()
  if (freshErr || !freshRow) return NextResponse.json({ error: 'Просчёт не прочитан — отправьте ещё раз' }, { status: 500 })
  const fresh = parseOrderNotes((freshRow as { notes: unknown }).notes)
  if (fresh.status === 'pending_approval') return NextResponse.json({ ok: true, already: true })
  const at = new Date().toISOString()
  const { error } = await svc.rpc('patch_order_notes_shallow', { p_order_id: quoteId, p_patch: {
    status: 'pending_approval',
    status_history: appendTo(fresh, 'status_history', { from: (fresh.status as string) || 'quote', to: 'pending_approval', date: at, by: 'partner' }),
    submitted_by_partner_at: at,
    ...(aiReview !== undefined ? { ai_review: aiReview } : {}),
  } })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await svc.from('b2b_orders').update({ updated_at: at }).eq('id', quoteId)

  // Аудит: партнёр отправил просчёт в работу (best-effort, не роняет ответ).
  await svc.from('security_events').insert({
    user_id: user.id, event: 'partner_quote_submitted',
    meta: { orderId: quoteId, clientId: client.id },
  }).then(() => {}, () => {})

  // Подтверждение партнёру в кабинет: заявка получена (best-effort).
  await pushNotification(svc, {
    clientId: client.id, orderId: quoteId, kind: 'submitted',
    title: `Заявка отправлена · №${quoteId}`,
    body: 'Менеджер проверит просчёт и запустит в работу. Статус появится здесь.',
    link: `/partner/order/${quoteId}`,
  }).catch(() => {})

  // Уведомление менеджерам/владельцу в Telegram (best-effort).
  const base = appUrl()
  await notifyAdmins(
    `🧾 <b>Новая заявка от партнёра</b>\n${client.name} отправил просчёт №${quoteId} в работу.` +
    (base ? `\n${base}/b2b-quotes` : ''),
  ).catch(() => {})

  return NextResponse.json({ ok: true })
}
