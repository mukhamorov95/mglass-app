// Приём сообщений Wazzup (WhatsApp, Telegram, MAX). С1 маршрута розничной CRM
// (docs/B2C_CRM_ROUTE.md): пакет сначала целиком ложится в inbound_events, потом
// разбирается — входящие в avito_messages_raw (имя историческое), исходящие менеджеров
// с текстом в wazzup_outgoing_messages. В AmoCRM отсюда больше ничего не уходит.

import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { checkWazzupSecret, wazzupWebhookSecret } from '@/lib/wazzupWebhookSecret'

export const maxDuration = 15

function db() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// В БД avito_messages_raw.message_type CHECK разрешает только этот набор. Wazzup
// же шлёт свои типы (image/document/sticker/location/contact/…). Раньше сырой
// msg.type уходил в insert как есть → CHECK violation → 400 → сообщение молча
// терялось (continue в приёмнике). Нормализуем в разрешённый набор.
const ALLOWED_MSG_TYPES = new Set(['text', 'photo', 'audio', 'file', 'video', 'system', 'unknown'])
function normalizeMessageType(raw: string): string {
  const k = raw.toLowerCase()
  if (k === 'image' || k === 'picture' || k === 'sticker') return 'photo'
  if (k === 'voice' || k === 'ptt') return 'audio'
  if (k === 'document') return 'file'
  if (ALLOWED_MSG_TYPES.has(k)) return k
  return 'unknown'
}
function detectMessageType(msg: Record<string, unknown>): string {
  if (msg.type && msg.type !== 'text') return normalizeMessageType(String(msg.type))
  const attachments = msg.attachments as Array<Record<string, unknown>> | undefined
  if (attachments?.length) {
    const kind = String(attachments[0].type ?? '')
    if (kind === 'image' || kind === 'photo') return 'photo'
    if (kind === 'audio' || kind === 'voice') return 'audio'
    if (kind === 'video') return 'video'
    return 'file'
  }
  if (msg.text) return 'text'
  return 'unknown'
}

function isOutgoing(msg: Record<string, unknown>): boolean {
  return (
    msg.isEcho === true ||
    msg.author === 'operator' ||
    msg.incoming === false ||
    msg.isOutgoing === true
  )
}

// Кто и что написал клиенту. В AmoCRM больше половины исходящих приходят без автора —
// отправлены из приложения Wazzup или с телефона; Wazzup сообщает автора сам.
// Текст храним с 13.10 (решение владельца). Возвращает false, если запись не удалась.
async function saveOutgoing(supabase: ReturnType<typeof db>, msg: Record<string, unknown>): Promise<boolean> {
  const id = msg.messageId ?? msg.id
  if (!id) return true
  const str = (v: unknown) => (v === undefined || v === null || v === '' ? null : String(v))
  const bool = (v: unknown) => (typeof v === 'boolean' ? v : null)
  const sentAt = str(msg.dateTime)
  try {
    const { error } = await supabase.from('wazzup_outgoing_messages').upsert({
      wazzup_message_id: String(id),
      channel_id:        str(msg.channelId),
      chat_id:           str(msg.chatId),
      chat_type:         str(msg.chatType),
      author_id:         str(msg.authorId),
      author_name:       str(msg.authorName),
      is_echo:           bool(msg.isEcho),
      sent_from_app:     bool(msg.sentFromApp),
      message_type:      str(msg.type),
      sent_at:           sentAt && !Number.isNaN(Date.parse(sentAt)) ? sentAt : new Date().toISOString(),
      payload_keys:      Object.keys(msg),
      text:              str(msg.text),
      content_uri:       str(msg.contentUri),
    }, { onConflict: 'wazzup_message_id', ignoreDuplicates: true })
    if (error) { console.error('[wazzup-webhook] outgoing save failed', error.message); return false }
    return true
  } catch (e) {
    console.error('[wazzup-webhook] outgoing save threw', e)
    return false
  }
}

export async function POST(req: Request) {
  // Чужой секрет — отказ. Вызов без секрета пока принимаем: старый адрес вебхука в Wazzup
  // без ?secret=. После перевода вебхука на hooks.mglass.pro с секретом — отказ и без него.
  const provided = new URL(req.url).searchParams.get('secret') ?? req.headers.get('x-webhook-secret')
  const secret = checkWazzupSecret(provided, wazzupWebhookSecret({
    WAZZUP_WEBHOOK_SECRET: process.env.WAZZUP_WEBHOOK_SECRET,
    WAZZUP_API_KEY: process.env.WAZZUP_API_KEY,
  }))
  if (secret === 'bad') return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (secret !== 'ok') console.warn(`[wazzup-webhook] вызов без секрета (${secret})`)

  let body: { messages?: unknown[] }
  try {
    body = await req.json()
  } catch {
    // Wazzup sometimes sends malformed JSON on test events
    return NextResponse.json({ ok: true })
  }

  const messages = Array.isArray(body.messages) ? body.messages : []
  if (!messages.length) return NextResponse.json({ ok: true })

  const supabase = db()

  // Журнал до разбора. Не записался — база недоступна: 503, пусть Wazzup пробует снова.
  const { data: event, error: eventErr } = await supabase
    .from('inbound_events').insert({ provider: 'wazzup', payload: body }).select('id').single()
  if (eventErr || !event) {
    console.error('[wazzup-webhook] inbound_events insert failed', eventErr?.message)
    return NextResponse.json({ error: 'storage_unavailable' }, { status: 503 })
  }
  const failures: string[] = []

  for (const raw of messages) {
    const msg = raw as Record<string, unknown>

    try {
      // Skip pure system events
      if (msg.type === 'system') continue

      // Outgoing echo: check if it's a human manager writing (not our bot's own echo)
      if (isOutgoing(msg)) {
        if (!(await saveOutgoing(supabase, msg))) failures.push(`out ${String(msg.messageId ?? msg.id ?? '?')}`)
        const chatId = String(msg.chatId ?? '')
        if (chatId) {
          const { data: chat } = await supabase
            .from('ai_managed_chats')
            .select('is_active, last_bot_reply_at')
            .eq('chat_id', chatId)
            .maybeSingle()
          // If bot is active and the last bot reply was >60s ago → human took over → pause
          if (chat?.is_active) {
            const lastReply = chat.last_bot_reply_at ? new Date(chat.last_bot_reply_at).getTime() : 0
            const isOwnEcho = Date.now() - lastReply < 60_000
            if (!isOwnEcho) {
              await supabase.from('ai_managed_chats').update({
                is_active: false,
                close_reason: 'manager_wrote',
              }).eq('chat_id', chatId)
              console.log(`[wazzup-webhook] bot paused — manager took over chat ${chatId}`)
            }
          }
        }
        continue
      }

      const wazzupId = (msg.id ?? msg.messageId ?? null) as string | null
      const chatId    = String(msg.chatId ?? '')
      const channelId = String(msg.channelId ?? '')
      const chatType  = String(msg.chatType ?? 'whatsapp')

      if (!chatId || !channelId) continue

      // ── Deduplication ────────────────────────────────────────────────────────
      if (wazzupId) {
        const { data: dup } = await supabase
          .from('avito_messages_raw')
          .select('id')
          .eq('wazzup_message_id', wazzupId)
          .maybeSingle()
        if (dup) continue
      }

      const msgType   = detectMessageType(msg)
      const contact   = msg.contact as Record<string, unknown> | undefined
      const text      = typeof msg.text === 'string' && msg.text ? msg.text : null
      const attachments = (msg.attachments as unknown[]) ?? null

      // ── 1. Save raw message ──────────────────────────────────────────────────
      const { data: saved, error: saveErr } = await supabase
        .from('avito_messages_raw')
        .insert({
          wazzup_message_id: wazzupId,
          chat_id:           chatId,
          channel_id:        channelId,
          chat_type:         chatType,
          direction:         'incoming',
          message_type:      msgType,
          text,
          contact_name:      (contact?.name as string) ?? null,
          attachments_json:  attachments,
          raw_payload_json:  msg,
          received_at:       new Date().toISOString(),
          processing_status: 'pending',
        })
        .select('id')
        .single()

      if (saveErr || !saved) {
        console.error('[wazzup-webhook] raw save failed', saveErr)
        failures.push(`in ${wazzupId ?? '?'}: ${saveErr?.message ?? 'no row'}`)
      }
    } catch (msgErr) {
      console.error('[wazzup-webhook] error processing single message', msgErr)
      failures.push(`msg: ${String(msgErr).slice(0, 120)}`)
    }
  }

  // Пакет уже в журнале: недоразобранное разберём из inbound_events, поэтому отвечаем 200.
  await supabase.from('inbound_events').update({
    status: failures.length ? 'failed' : 'processed',
    error: failures.length ? failures.join('; ').slice(0, 2000) : null,
    processed_at: new Date().toISOString(),
  }).eq('id', event.id)

  return NextResponse.json({ ok: true })
}
