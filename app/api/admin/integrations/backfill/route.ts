/**
 * POST /api/admin/integrations/backfill
 *
 * Step 0 — Import from ai_conversations (old system):
 *   Read user messages from ai_conversations + ai_managed_chats.
 *   For each message not yet in avito_messages_raw, create a raw record
 *   and a queue entry so it gets synced to AmoCRM.
 *
 * Step 1 — Orphan recovery:
 *   Find avito_messages_raw rows with no matching message_queue entry.
 *
 * Step 2 — Reset failed queue items back to pending.
 *
 * Step 3 — Process the whole queue inline (AMO sync, no AI).
 */

import { NextResponse }        from 'next/server'
import { createClient as svc } from '@supabase/supabase-js'
import { requireOwner }        from '@/lib/apiAuth'
import type { SupabaseClient } from '@supabase/supabase-js'

export const maxDuration = 60

const AMO_BASE  = `https://${process.env.AMO_SUBDOMAIN}.amocrm.ru/api/v4`
const AMO_TOKEN = process.env.AMO_ACCESS_TOKEN!

function db() {
  return svc(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// ── AMO helpers ───────────────────────────────────────────────────────────────
async function amoGet(path: string): Promise<unknown> {
  const res = await fetch(`${AMO_BASE}${path}`, {
    headers: { Authorization: `Bearer ${AMO_TOKEN}` },
    cache: 'no-store',
  })
  if (!res.ok || res.status === 204) return null
  return res.json()
}

async function addAmoNote(leadId: number, text: string) {
  await fetch(`${AMO_BASE}/leads/${leadId}/notes`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${AMO_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([{ note_type: 'common', params: { text } }]),
  })
}

async function findLeadByPhone(chatId: string): Promise<number | null> {
  const clean = chatId.replace(/\D/g, '').replace(/^8/, '7')
  if (clean.length < 10) return null
  const data = await amoGet(`/contacts?query=${clean}&with=leads`) as {
    _embedded?: { contacts?: Array<{ _embedded?: { leads?: Array<{ id: number }> } }> }
  } | null
  const contacts = data?._embedded?.contacts
  if (!contacts?.length) return null
  const leads = contacts[0]?._embedded?.leads
  if (!leads?.length) return null
  const leadId = leads[leads.length - 1].id
  const lead = await amoGet(`/leads/${leadId}`) as { id: number } | null
  return lead?.id ?? null
}

function buildNote(raw: Record<string, unknown>): string {
  const lines: string[] = []
  const ch = raw.chat_type === 'avito' ? 'Avito' : String(raw.chat_type ?? '')
  lines.push(`📱 Канал: ${ch}`)
  if (raw.contact_name) lines.push(`👤 Клиент: ${raw.contact_name}`)
  if (raw.text)         lines.push(`💬 ${raw.text}`)
  const t = String(raw.message_type ?? '')
  if (t && t !== 'text' && t !== 'unknown') {
    const icons: Record<string, string> = { photo: '🖼️ Фото', audio: '🎵 Аудио', video: '📹 Видео', file: '📎 Файл' }
    lines.push(icons[t] ?? `📎 ${t}`)
  }
  if (raw.received_at) {
    lines.push(`🕐 ${new Date(String(raw.received_at)).toLocaleString('ru-RU')}`)
  }
  lines.push('(восстановлено через backfill)')
  return lines.join('\n')
}

// ── Step 0: Import history from ai_conversations ──────────────────────────────
async function importFromAiHistory(supabase: SupabaseClient): Promise<{
  checked: number; imported: number; errors: string[]
}> {
  const result = { checked: 0, imported: 0, errors: [] as string[] }

  // Get all real chats (skip the __debug__ entry)
  const { data: chats } = await supabase
    .from('ai_managed_chats')
    .select('chat_id, channel_id, chat_type, amo_lead_id, client_name')
    .not('chat_id', 'eq', '__debug__')
    .not('amo_lead_id', 'is', null)

  if (!chats?.length) return result

  // Build a set of chat_ids + timestamps already in avito_messages_raw
  // to avoid duplicating imports on repeated runs
  const { data: existingRaw } = await supabase
    .from('avito_messages_raw')
    .select('chat_id, received_at')

  const existingKeys = new Set(
    (existingRaw ?? []).map((r: { chat_id: string; received_at: string }) =>
      `${r.chat_id}::${r.received_at}`
    )
  )

  for (const chat of chats) {
    // Get all user messages for this chat
    const { data: messages } = await supabase
      .from('ai_conversations')
      .select('id, role, content, created_at')
      .eq('chat_id', chat.chat_id)
      .eq('role', 'user')
      .order('created_at', { ascending: true })

    if (!messages?.length) continue
    result.checked += messages.length

    for (const msg of messages) {
      const key = `${chat.chat_id}::${msg.created_at}`
      if (existingKeys.has(key)) continue  // already imported

      try {
        // Create raw message record
        const { data: rawRow, error: rawErr } = await supabase
          .from('avito_messages_raw')
          .insert({
            wazzup_message_id: null,  // old system had no message IDs
            chat_id:           chat.chat_id,
            channel_id:        chat.channel_id ?? 'unknown',
            chat_type:         chat.chat_type ?? 'whatsapp',
            direction:         'incoming',
            message_type:      'text',
            text:              msg.content,
            contact_name:      chat.client_name ?? null,
            attachments_json:  null,
            raw_payload_json:  { source: 'ai_conversations_import', original_id: msg.id },
            received_at:       msg.created_at,
            processing_status: 'pending',
          })
          .select('id')
          .single()

        if (rawErr || !rawRow) {
          result.errors.push(`Insert raw for ${chat.chat_id}: ${rawErr?.message}`)
          continue
        }

        existingKeys.add(key)

        // Create queue entry — use amo_lead_id from ai_managed_chats directly
        await supabase.from('message_queue').insert({
          source:         'wazzup',
          raw_message_id: rawRow.id,
          status:         'pending',
          attempts:       0,
          max_attempts:   5,
          amo_lead_id:    chat.amo_lead_id,  // already known!
        })

        // Pre-populate external_conversations so the processor skips the phone lookup
        await supabase.from('external_conversations').upsert({
          source:              'wazzup',
          external_chat_id:    chat.chat_id,
          external_channel_id: chat.channel_id ?? 'unknown',
          chat_type:           chat.chat_type ?? 'whatsapp',
          amo_lead_id:         chat.amo_lead_id,
          client_name:         chat.client_name ?? null,
          last_message_at:     msg.created_at,
          updated_at:          new Date().toISOString(),
        }, { onConflict: 'source,external_chat_id' })

        result.imported++
      } catch (e) {
        result.errors.push(`chat ${chat.chat_id}: ${String(e)}`)
      }
    }
  }

  return result
}

// ── Inline queue processor (AMO sync only, no AI) ─────────────────────────────
async function runQueueInline(supabase: SupabaseClient): Promise<number> {
  const now = new Date().toISOString()
  const { data: items } = await supabase
    .from('message_queue')
    .select('id, raw_message_id, attempts, max_attempts, amo_lead_id')
    .or(`status.eq.pending,and(status.eq.retry_scheduled,next_retry_at.lte.${now})`)
    .order('created_at', { ascending: true })
    .limit(40)

  if (!items?.length) return 0

  let synced = 0

  for (const item of items) {
    try {
      await supabase.from('message_queue').update({
        status: 'processing', attempts: item.attempts + 1, updated_at: new Date().toISOString(),
      }).eq('id', item.id)

      const { data: raw } = await supabase
        .from('avito_messages_raw')
        .select('*')
        .eq('id', item.raw_message_id)
        .single()

      if (!raw) {
        await supabase.from('message_queue').update({ status: 'failed', last_error: 'Raw not found' }).eq('id', item.id)
        continue
      }

      // Use lead ID from queue item (set during import) or look up by phone
      let leadId: number | null = item.amo_lead_id ?? null

      if (!leadId) {
        const { data: conv } = await supabase
          .from('external_conversations')
          .select('amo_lead_id')
          .eq('source', 'wazzup')
          .eq('external_chat_id', raw.chat_id)
          .maybeSingle()
        leadId = conv?.amo_lead_id ?? null
      }

      if (!leadId) {
        leadId = await findLeadByPhone(raw.chat_id)
      }

      if (leadId) {
        await addAmoNote(leadId, buildNote(raw as Record<string, unknown>))
        await supabase.from('external_conversations').upsert({
          source: 'wazzup', external_chat_id: raw.chat_id,
          external_channel_id: raw.channel_id, chat_type: raw.chat_type,
          amo_lead_id: leadId, client_name: raw.contact_name ?? null,
          last_message_at: raw.received_at, updated_at: new Date().toISOString(),
        }, { onConflict: 'source,external_chat_id' })
      }

      await supabase.from('message_queue').update({
        status: 'synced_to_amocrm', amo_lead_id: leadId, updated_at: new Date().toISOString(),
      }).eq('id', item.id)
      await supabase.from('avito_messages_raw').update({ processing_status: 'done' }).eq('id', raw.id)
      synced++

    } catch (e) {
      await supabase.from('message_queue').update({
        status: 'failed', last_error: String(e), updated_at: new Date().toISOString(),
      }).eq('id', item.id)
    }
  }

  return synced
}

// ── Main handler ──────────────────────────────────────────────────────────────
export async function POST() {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard

  const supabase = db()
  const summary = {
    historyChecked:  0,
    historyImported: 0,
    orphansFound:    0,
    orphansQueued:   0,
    failedReset:     0,
    queueProcessed:  0,
    errors:          [] as string[],
  }

  // ── Step 0: Import from ai_conversations ─────────────────────────────────────
  try {
    const hist = await importFromAiHistory(supabase)
    summary.historyChecked  = hist.checked
    summary.historyImported = hist.imported
    if (hist.errors.length) summary.errors.push(...hist.errors.slice(0, 3))
  } catch (e) {
    summary.errors.push(`History import: ${String(e)}`)
  }

  // ── Step 1: Orphan recovery ──────────────────────────────────────────────────
  try {
    const { data: queued } = await supabase.from('message_queue').select('raw_message_id')
    const queuedIds = new Set((queued ?? []).map((r: { raw_message_id: string }) => r.raw_message_id))

    const { data: orphans } = await supabase
      .from('avito_messages_raw')
      .select('id')
      .eq('processing_status', 'pending')
      .order('received_at', { ascending: true })

    const novel = (orphans ?? []).filter((r: { id: string }) => !queuedIds.has(r.id))
    summary.orphansFound = novel.length

    if (novel.length > 0) {
      const { error } = await supabase.from('message_queue').insert(
        novel.map((r: { id: string }) => ({
          source: 'wazzup', raw_message_id: r.id, status: 'pending', attempts: 0, max_attempts: 5,
        }))
      )
      if (error) summary.errors.push(`Orphan insert: ${error.message}`)
      else summary.orphansQueued = novel.length
    }
  } catch (e) {
    summary.errors.push(`Orphan step: ${String(e)}`)
  }

  // ── Step 2: Reset failed ─────────────────────────────────────────────────────
  try {
    const { data, error } = await supabase
      .from('message_queue')
      .update({ status: 'pending', next_retry_at: null, attempts: 0, updated_at: new Date().toISOString() })
      .eq('status', 'failed')
      .select('id')
    if (error) summary.errors.push(`Failed reset: ${error.message}`)
    else summary.failedReset = (data ?? []).length
  } catch (e) {
    summary.errors.push(`Failed reset: ${String(e)}`)
  }

  // ── Step 3: Process inline ───────────────────────────────────────────────────
  try {
    summary.queueProcessed = await runQueueInline(supabase)
  } catch (e) {
    summary.errors.push(`Queue processor: ${String(e)}`)
  }

  return NextResponse.json({ ok: summary.errors.length === 0, summary })
}
