/**
 * Queue processor — runs every minute via Vercel cron.
 *
 * Flow per queue item:
 *   1. Mark as "processing"
 *   2. Sync message to AmoCRM (find/create contact+lead, add note)   ← CRITICAL
 *   3. Update external_conversations link table
 *   4. Mark as "synced_to_amocrm"
 *
 * AmoCRM sync failure → retry_scheduled (exponential backoff, max 5 attempts)
 *
 * Конвейер только ДОСТАВЛЯЕТ сообщения в CRM. Отвечает клиентам исключительно
 * Иван (контур Авито) — правило владельца.
 */

import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export const maxDuration = 60

// ── Constants ─────────────────────────────────────────────────────────────────
const AMO_BASE        = `https://${process.env.AMO_SUBDOMAIN}.amocrm.ru/api/v4`
const AMO_TOKEN       = process.env.AMO_ACCESS_TOKEN!
const BATCH_SIZE      = 8   // items to process per cron run
const FRESH_DAYS      = 3   // старше — не доставляем без решения владельца

// Retry delays in seconds: attempt 1 → 60s, 2 → 300s, 3 → 900s, 4 → 3600s, 5 → fail
const RETRY_DELAYS = [60, 300, 900, 3600]

// ── Supabase ──────────────────────────────────────────────────────────────────
function db() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// ── AMO helpers ───────────────────────────────────────────────────────────────
async function amoGet(path: string): Promise<unknown> {
  const res = await fetch(`${AMO_BASE}${path}`, {
    headers: { Authorization: `Bearer ${AMO_TOKEN}` },
    cache: 'no-store',
  })
  // 204/404 — ресурс реально отсутствует (нет контакта/лида) → null, это НЕ ошибка.
  if (res.status === 204 || res.status === 404) return null
  // 401/429/5xx — временный сбой AMO. НЕ считаем «лид не найден» (иначе нота молча
  // не доставится, а элемент пометится synced). Бросаем → уходит в retry_scheduled.
  if (!res.ok) throw new Error(`AMO GET ${path} → HTTP ${res.status}`)
  return res.json()
}

async function addAmoNote(leadId: number, text: string): Promise<void> {
  const res = await fetch(`${AMO_BASE}/leads/${leadId}/notes`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${AMO_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([{ note_type: 'common', params: { text } }]),
  })
  // Раньше результат не проверялся: неудачный POST (429/401/5xx) молча терял ноту,
  // а элемент помечался synced_to_amocrm. Теперь бросаем → ретрай.
  if (!res.ok) throw new Error(`AMO addNote lead ${leadId} → HTTP ${res.status}`)
}

async function findLeadByPhone(phone: string): Promise<{ id: number; responsible_user_id: number } | null> {
  const clean = phone.replace(/\D/g, '').replace(/^8/, '7')
  const data = await amoGet(`/contacts?query=${clean}&with=leads`) as {
    _embedded?: { contacts?: Array<{ _embedded?: { leads?: Array<{ id: number }> } }> }
  } | null
  const contacts = data?._embedded?.contacts
  if (!contacts?.length) return null
  const leads = contacts[0]?._embedded?.leads
  if (!leads?.length) return null
  const leadId = leads[leads.length - 1].id
  const lead = await amoGet(`/leads/${leadId}`) as { id: number; responsible_user_id: number } | null
  if (!lead) return null
  return { id: lead.id, responsible_user_id: lead.responsible_user_id }
}

// ── Format message content for AMO note ───────────────────────────────────────
function buildAmoNote(raw: RawMessage): string {
  const lines: string[] = []
  const channelLabel = raw.chat_type === 'avito' ? 'Avito' : raw.chat_type
  lines.push(`📱 Канал: ${channelLabel}`)
  if (raw.contact_name) lines.push(`👤 Клиент: ${raw.contact_name}`)
  if (raw.text)         lines.push(`💬 ${raw.text}`)
  if (raw.message_type !== 'text' && raw.message_type !== 'unknown') {
    const typeLabel: Record<string, string> = {
      photo: '🖼️ Фото', audio: '🎵 Аудио', video: '📹 Видео', file: '📎 Файл',
    }
    const label = typeLabel[raw.message_type] ?? `📎 ${raw.message_type}`
    const atts  = Array.isArray(raw.attachments_json) ? raw.attachments_json : []
    lines.push(atts.length > 1 ? `${label} (${atts.length} шт.)` : label)
  }
  return lines.join('\n')
}

// ── AmoCRM sync: find or use cached lead, add note ────────────────────────────
async function syncToAmocrm(raw: RawMessage): Promise<number | null> {
  const supabase = db()

  // 1. Check our conversation cache
  const { data: conv } = await supabase
    .from('external_conversations')
    .select('amo_lead_id, amo_contact_id, client_name')
    .eq('source', 'wazzup')
    .eq('external_chat_id', raw.chat_id)
    .maybeSingle()

  let leadId: number | null = conv?.amo_lead_id ?? null

  // 2. If not cached — look up AMO by phone (WhatsApp chat_id is the phone)
  if (!leadId) {
    const isPhone = /^\+?[0-9]{10,15}$/.test(raw.chat_id.replace(/\s/g, ''))
    if (isPhone) {
      const lead = await findLeadByPhone(raw.chat_id)
      leadId = lead?.id ?? null
    }
  }

  // 3. Add note to AMO lead if found
  if (leadId) {
    await addAmoNote(leadId, buildAmoNote(raw))
  } else {
    // No lead found — note this but don't fail. AI-managed chat may create one later.
    console.log(`[process-queue] no AMO lead for chat ${raw.chat_id} (${raw.chat_type})`)
  }

  // 4. Upsert external_conversations (even if no lead — keeps channel/name info)
  await supabase.from('external_conversations').upsert({
    source:              'wazzup',
    external_chat_id:    raw.chat_id,
    external_channel_id: raw.channel_id,
    chat_type:           raw.chat_type,
    amo_lead_id:         leadId,
    client_name:         raw.contact_name ?? conv?.client_name ?? null,
    last_message_at:     new Date().toISOString(),
    updated_at:          new Date().toISOString(),
  }, { onConflict: 'source,external_chat_id' })

  return leadId
}

// ── Retry scheduling ───────────────────────────────────────────────────────────
function nextRetryAt(attempt: number): string | null {
  const delaySec = RETRY_DELAYS[attempt - 1]
  if (!delaySec) return null  // exceeded max retries
  return new Date(Date.now() + delaySec * 1000).toISOString()
}

// ── Types ──────────────────────────────────────────────────────────────────────
interface RawMessage {
  id:               string
  chat_id:          string
  channel_id:       string
  chat_type:        string
  direction:        string
  message_type:     string
  text:             string | null
  contact_name:     string | null
  attachments_json: unknown
  raw_payload_json: unknown
}

interface QueueItem {
  id:             string
  raw_message_id: string
  attempts:       number
  max_attempts:   number
  status:         string
}

// ── Process a single queue item ────────────────────────────────────────────────
async function processItem(item: QueueItem): Promise<'claimed' | 'skipped'> {
  const supabase = db()
  const newAttempts = item.attempts + 1

  // Атомарный клейм: помечаем processing ТОЛЬКО если строка ещё в исходном статусе.
  // Конвейер дёргается и инлайн из вебхука, и кроном — без этого две параллельные
  // обработки берут одни строки и постят дубли нот в AMO. Пустой результат =
  // строку уже забрал другой обработчик → выходим.
  const { data: claimed } = await supabase.from('message_queue').update({
    status: 'processing', attempts: newAttempts, updated_at: new Date().toISOString(),
  }).eq('id', item.id).in('status', ['pending', 'retry_scheduled']).select('id')
  if (!claimed || claimed.length === 0) return 'skipped'

  // Fetch raw message
  const { data: raw, error: rawErr } = await supabase
    .from('avito_messages_raw')
    .select('*')
    .eq('id', item.raw_message_id)
    .single()

  if (rawErr || !raw) {
    await supabase.from('message_queue').update({
      status: 'failed',
      last_error: 'Raw message not found',
      updated_at: new Date().toISOString(),
    }).eq('id', item.id)
    return 'claimed'
  }

  // ── Step 1: AmoCRM sync ─────────────────────────────────────────────────────
  let leadId: number | null = null
  try {
    leadId = await syncToAmocrm(raw as RawMessage)
    await supabase.from('message_queue').update({
      status: 'synced_to_amocrm', amo_lead_id: leadId, updated_at: new Date().toISOString(),
    }).eq('id', item.id)
    await supabase.from('avito_messages_raw').update({ processing_status: 'processing' }).eq('id', raw.id)
  } catch (syncErr) {
    const errMsg = String(syncErr)
    const retry = nextRetryAt(newAttempts)
    if (retry && newAttempts < item.max_attempts) {
      await supabase.from('message_queue').update({
        status: 'retry_scheduled',
        attempts: newAttempts,
        next_retry_at: retry,
        last_error: errMsg,
        updated_at: new Date().toISOString(),
      }).eq('id', item.id)
    } else {
      await supabase.from('message_queue').update({
        status: 'failed',
        last_error: errMsg,
        updated_at: new Date().toISOString(),
      }).eq('id', item.id)
      await supabase.from('avito_messages_raw').update({ processing_status: 'failed', error_message: errMsg }).eq('id', raw.id)
    }
    console.error(`[process-queue] AMO sync failed for item ${item.id}:`, errMsg)
    return 'claimed'
  }

  // Доставка в CRM выполнена — на этом работа конвейера закончена.
  // AI-половина (бот «Владислав») удалена: она была отключена `return null`
  // с мая и противоречила правилу «клиентам пишет только Иван».
  try {
    await supabase.from('message_queue').update({
      status: 'synced_to_amocrm',
      updated_at: new Date().toISOString(),
    }).eq('id', item.id)
  } catch (aiErr) {
    console.error(`[process-queue] status update failed for item ${item.id}:`, String(aiErr))
    await supabase.from('message_queue').update({
      status: 'synced_to_amocrm',
      last_error: String(aiErr),
      updated_at: new Date().toISOString(),
    }).eq('id', item.id)
  }

  await supabase.from('avito_messages_raw').update({ processing_status: 'done' }).eq('id', raw.id)
  return 'claimed'
}

// ── Cron entry point ──────────────────────────────────────────────────────────
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = db()

  // Kill-switch с /vladislav: бот выключен — очередь не разгребаем автоматикой.
  const { isBotEnabled } = await import('@/lib/aiKillSwitch')
  if (!(await isBotEnabled(supabase))) {
    return NextResponse.json({ ok: true, skipped: 'bot_disabled' })
  }
  const now = new Date().toISOString()

  // Берём только свежие сообщения. Крон этого конвейера не был прописан в
  // vercel.json, поэтому в очереди накопился двухмесячный хвост — заливать его
  // в карточки CRM задним числом нельзя, это решает владелец (см. FRESH_DAYS).
  const freshFrom = new Date(Date.now() - FRESH_DAYS * 86_400_000).toISOString()

  // Pick pending items + retry_scheduled items whose retry time has passed
  const { data: items, error } = await supabase
    .from('message_queue')
    .select('id, raw_message_id, attempts, max_attempts, status')
    .or(`status.eq.pending,and(status.eq.retry_scheduled,next_retry_at.lte.${now})`)
    .gte('created_at', freshFrom)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (error) {
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 })
  }

  if (!items?.length) {
    return NextResponse.json({ ok: true, processed: 0, message: 'Queue empty' })
  }

  const results: Array<{ id: string; status: string; error?: string }> = []

  for (const item of items as QueueItem[]) {
    try {
      const outcome = await processItem(item)
      results.push({ id: item.id, status: outcome === 'skipped' ? 'skipped' : 'ok' })
    } catch (err) {
      console.error(`[process-queue] unhandled error for item ${item.id}:`, err)
      results.push({ id: item.id, status: 'error', error: String(err) })
      // Mark as failed in case processItem threw before doing so
      await supabase.from('message_queue').update({
        status: 'failed',
        last_error: String(err),
        updated_at: new Date().toISOString(),
      }).eq('id', item.id).eq('status', 'processing')
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results })
}

// Allow POST for manual trigger from admin
export const POST = GET
