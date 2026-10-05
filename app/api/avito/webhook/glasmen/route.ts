import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { parseAvitoEvent, avitoChatUrl, inquiryNotifyText, type AvitoWebhookBody } from '@/lib/b2b/avitoInquiry'
import { glasmenChatInfo, glasmenUserId } from '@/lib/avito/glasmen'
import { notifyInquiryRecipients, inquiryAssignee } from '@/lib/b2b/inquiryNotify'
import { statusPatch, type Inquiry } from '@/lib/b2b/inquiries'

export const dynamic = 'force-dynamic'

// Вебхук мессенджера кабинета GLASMEN (производство). Чат клиента → входящая заявка B2B
// (b2b_inquiries), уведомление в Telegram. В AmoCRM ничего не уходит (решение владельца 05.10),
// бота нет — отвечает человек; наш ответ в чате отмечает заявку отвеченной.
//
// Путь под /api/avito/webhook — он в белом списке middleware. Пишет service-role'ом, поэтому
// ворота здесь свои: без AVITO_GLASMEN_WEBHOOK_SECRET и AVITO_GLASMEN_USER_ID маршрут закрыт
// (а не открыт, как бывает с «если секрет задан»).

const INQUIRY_COLS = 'id, source, contact_name, company, phone, chat_url, listing, request, status, answered_at, closed_at, lost_reason'
const CLOSED = new Set(['won', 'lost'])

export async function POST(req: NextRequest) {
  const secret = process.env.AVITO_GLASMEN_WEBHOOK_SECRET
  const ownUserId = glasmenUserId()
  if (!secret || !ownUserId) return NextResponse.json({ error: 'not configured' }, { status: 503 })
  if (req.nextUrl.searchParams.get('key') !== secret) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null) as AvitoWebhookBody | null
  const ev = parseAvitoEvent(body, ownUserId)
  if (ev.kind === 'skip') return NextResponse.json({ ok: true, skipped: ev.reason })

  const svc = createServiceClient()

  // Авито ретраит вебхук: каждое сообщение обрабатываем один раз (общая таблица дедупа
  // с розничным вебхуком, ключи разведены префиксом).
  const { data: fresh, error: dupErr } = await svc.from('avito_processed_messages')
    .upsert({ msg_id: `glasmen:${ev.msgId}` }, { onConflict: 'msg_id', ignoreDuplicates: true })
    .select('msg_id')
  if (dupErr) {
    console.error('[avito-glasmen] дедуп не записан', dupErr.message)
    return NextResponse.json({ error: 'db' }, { status: 500 })
  }
  if (!fresh?.length) return NextResponse.json({ ok: true, duplicate: true })

  const { data: found, error: findErr } = await svc.from('b2b_inquiries')
    .select(INQUIRY_COLS).eq('avito_chat_id', ev.chatId).maybeSingle()
  if (findErr) {
    console.error('[avito-glasmen] заявка не прочитана', findErr.message)
    return NextResponse.json({ error: 'db' }, { status: 500 })
  }
  const cur = found as unknown as Inquiry | null

  if (ev.kind === 'out') {
    // Мы ответили клиенту: первая реакция закрывает таймер 30 минут.
    if (!cur) return NextResponse.json({ ok: true, out: 'no inquiry' })
    const patch = cur.status === 'new'
      ? { ...statusPatch(cur, 'answered', ev.at, null), last_message_at: ev.at }
      : { last_message_at: ev.at }
    const { error } = await svc.from('b2b_inquiries').update(patch).eq('id', cur.id)
    if (error) console.error('[avito-glasmen] ответ не отмечен', error.message)
    return NextResponse.json({ ok: true, out: cur.status === 'new' ? 'answered' : 'logged' })
  }

  if (cur) {
    // Клиент вернулся в закрытый чат — это новый разговор: в работу и уведомить.
    const reopen = CLOSED.has(cur.status)
    const patch = reopen
      ? { ...statusPatch(cur, 'new', ev.at, null), answered_at: null, last_message_at: ev.at }
      : { last_message_at: ev.at }
    const { error } = await svc.from('b2b_inquiries').update(patch).eq('id', cur.id)
    if (error) console.error('[avito-glasmen] сообщение не отмечено', error.message)
    if (reopen) await notifyInquiryRecipients(inquiryNotifyText({ ...cur, request: ev.text || cur.request }, 'again'))
    return NextResponse.json({ ok: true, inquiry: cur.id, reopened: reopen })
  }

  const info = await glasmenChatInfo(ev.chatId)
  const row = {
    source: 'avito',
    contact_name: info.contactName,
    chat_url: avitoChatUrl(ev.chatId),
    listing: info.listing,
    request: ev.text || null,
    avito_chat_id: ev.chatId,
    avito_item_id: ev.itemId,
    last_message_at: ev.at,
    created_by: null,
    assigned_to: await inquiryAssignee(),
  }
  const { data: created, error: insErr } = await svc.from('b2b_inquiries')
    .insert(row).select(INQUIRY_COLS).single()
  if (insErr) {
    // Гонка двух первых сообщений одного чата: второе упирается в уникальный индекс.
    if (insErr.code === '23505') return NextResponse.json({ ok: true, raced: true })
    console.error('[avito-glasmen] заявка не создана', insErr.message)
    return NextResponse.json({ error: 'db' }, { status: 500 })
  }
  await notifyInquiryRecipients(inquiryNotifyText(created as unknown as Inquiry, 'new'))
  return NextResponse.json({ ok: true, inquiry: (created as { id: number }).id, created: true })
}
