/**
 * Wazzup webhook receiver.
 *
 * Architecture: Avito/WhatsApp → Wazzup → HERE → raw storage → queue → AmoCRM + AI (async)
 *
 * This handler must be FAST:
 *   1. Parse incoming messages
 *   2. Save each message to avito_messages_raw
 *   3. Add a queue entry
 *   4. Return 200 OK immediately
 *
 * AmoCRM sync and AI processing are handled by /api/cron/process-queue.
 * If AI or AmoCRM fail, messages are NOT lost — they stay in the queue with retry.
 */

import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export const maxDuration = 15

function db() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function detectMessageType(msg: Record<string, unknown>): string {
  if (msg.type && msg.type !== 'text') return String(msg.type)
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

export async function POST(req: Request) {
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

  for (const raw of messages) {
    const msg = raw as Record<string, unknown>

    try {
      // Skip pure system events and echoes of our own sent messages
      if (msg.type === 'system') continue
      if (isOutgoing(msg)) continue

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
        continue
      }

      // ── 2. Enqueue for processing ────────────────────────────────────────────
      const { error: qErr } = await supabase.from('message_queue').insert({
        source:         'wazzup',
        raw_message_id: saved.id,
        status:         'pending',
        attempts:       0,
        max_attempts:   5,
      })

      if (qErr) {
        console.error('[wazzup-webhook] queue insert failed', qErr)
        // Raw message is saved — cron will re-enqueue or admin can retry
      }

    } catch (msgErr) {
      console.error('[wazzup-webhook] error processing single message', msgErr)
      // Never let one bad message break the whole batch
    }
  }

  // Always return 200 so Wazzup does not retry the webhook
  return NextResponse.json({ ok: true })
}
