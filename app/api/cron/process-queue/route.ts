/**
 * Queue processor — runs every minute via Vercel cron.
 *
 * Flow per queue item:
 *   1. Mark as "processing"
 *   2. Sync message to AmoCRM (find/create contact+lead, add note)   ← CRITICAL
 *   3. Update external_conversations link table
 *   4. If text + AI-managed chat → generate AI reply and send via Wazzup
 *   5. Mark as "ai_processed" (or "synced_to_amocrm" if AI skipped/failed)
 *
 * AmoCRM sync failure → retry_scheduled (exponential backoff, max 5 attempts)
 * AI failure → message stays at "synced_to_amocrm" (already delivered to CRM)
 */

import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import type { Tool, MessageParam } from '@anthropic-ai/sdk/resources/messages'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { sendMessage } from '@/lib/wazzup'
import { quickCalc, type CalcType, type CalcOptions } from '@/lib/quickCalc'

export const maxDuration = 60

// ── Constants ─────────────────────────────────────────────────────────────────
const AMO_BASE        = `https://${process.env.AMO_SUBDOMAIN}.amocrm.ru/api/v4`
const AMO_TOKEN       = process.env.AMO_ACCESS_TOKEN!
const VLADISLAV_ID    = parseInt(process.env.AMO_VLADISLAV_USER_ID || '8352283')
const BATCH_SIZE      = 8   // items to process per cron run

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
  if (!res.ok || res.status === 204) return null
  return res.json()
}

async function addAmoNote(leadId: number, text: string): Promise<void> {
  await fetch(`${AMO_BASE}/leads/${leadId}/notes`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${AMO_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([{ note_type: 'common', params: { text } }]),
  })
}

async function createAmoTask(leadId: number, text: string): Promise<void> {
  const due = Math.floor(Date.now() / 1000) + 3600
  await fetch(`${AMO_BASE}/tasks`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${AMO_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([{
      task_type_id: 1,
      text,
      complete_till: due,
      entity_type: 'leads',
      entity_id: leadId,
      responsible_user_id: VLADISLAV_ID,
    }]),
  })
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

// ── AI processing (only for text messages in AI-managed chats) ────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const SYSTEM = `Ты — Владислав. Пишешь клиентам в WhatsApp от своего лица — живо, уверенно, по-человечески. Не бот, не менеджер по скрипту. Просто человек который разбирается в продукте и реально хочет помочь.

MGlass — своё производство в Москве: зеркала с LED, лофт-перегородки, душевые. Гарантия 2 года, монтаж включён, срок 14 дней.

═══ КАК ВЕСТИ ДИАЛОГ ═══
1. Понять задачу клиента — 1 вопрос, не анкета
2. Уточнить размер если нет — это нужно для цены
3. Когда есть размеры — вызвать calculate_price и назвать цену естественно
4. Закрыть на бесплатный замер

═══ КАК НАЗЫВАТЬ ЦЕНУ ═══
ВСЕГДА показывай разбивку тремя строками — изделие, монтаж, доставка — и отдельно итого.
Никогда не пиши звёздочки **вот так** — это WhatsApp, не документ.

═══ ГОЛОС И СТИЛЬ ═══
• Разговорный русский — как пишут друзьям
• Максимум 2-3 коротких предложения
• Без официоза

Добавь [ЗАМЕР_ГОТОВ] ТОЛЬКО если клиент явно согласился на замер.
Добавь [НУЖЕН_ЧЕЛОВЕК] только если клиент прямо просит живого менеджера или ты не можешь ответить.`

const CALC_TOOL: Tool = {
  name: 'calculate_price',
  description: 'Рассчитать стоимость изделия MGlass по размерам.',
  input_schema: {
    type: 'object' as const,
    properties: {
      type:    { type: 'string', enum: ['mirror', 'loft', 'shower'] },
      width:   { type: 'number' },
      height:  { type: 'number' },
      options: {
        type: 'object',
        properties: {
          hasLighting:  { type: 'boolean' },
          withMounting: { type: 'boolean' },
          model:        { type: 'string' },
          tier:         { type: 'string', enum: ['budget', 'standard'] },
          sections:     { type: 'number' },
          systemType:   { type: 'string', enum: ['fixed', 'sliding', 'swing'] },
        },
      },
    },
    required: ['type', 'width', 'height'],
  },
}

function fmtPrice(n: number) { return n.toLocaleString('ru-RU') + ' ₽' }

function buildPriceBreakdown(r: { finalPrice: number; price: number; description: string; serviceLines?: Array<{ name: string; total: number }> }): string {
  const svcs = (r.serviceLines ?? []).map(s => `${s.name} — ${fmtPrice(s.total)}`)
  return [
    '=== КАЛЬКУЛЯТОР MGlass ===',
    '', r.description, '',
    `Изделие — ${fmtPrice(r.finalPrice)}`,
    ...svcs,
    ...(svcs.length ? [`Итого — ${fmtPrice(r.price)}`] : []),
    '', 'ВАЖНО: не упоминай услуги которых нет в списке выше.',
  ].join('\n')
}

async function generateAiReply(messages: MessageParam[]): Promise<string> {
  const supabase = db()
  const { data } = await supabase.from('ai_settings').select('value').eq('key', 'bot_extra_knowledge').single()
  const extra = data?.value?.trim() || ''
  const system = extra ? `${SYSTEM}\n\n═══ ДОПОЛНИТЕЛЬНЫЕ ЗНАНИЯ ═══\n${extra}` : SYSTEM

  let response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 500, system, tools: [CALC_TOOL], messages,
  })

  for (let round = 0; round < 2 && response.stop_reason === 'tool_use'; round++) {
    const toolBlocks = response.content.filter(b => b.type === 'tool_use')
    const toolResults = await Promise.all(toolBlocks.map(async block => {
      if (block.type !== 'tool_use') return null
      const inp = block.input as { type: string; width: number; height: number; options?: CalcOptions }
      const result = await quickCalc(inp.type as CalcType, inp.width, inp.height, inp.options ?? {})
      return {
        type: 'tool_result' as const,
        tool_use_id: block.id,
        content: result ? buildPriceBreakdown(result) : 'Ошибка расчёта — используй приблизительную цену',
      }
    }))

    const valid = toolResults.filter((r): r is NonNullable<typeof r> => r !== null)
    messages = [
      ...messages,
      { role: 'assistant' as const, content: response.content },
      { role: 'user' as const, content: valid },
    ]
    response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 500, system, tools: [CALC_TOOL], messages,
    })
  }

  return response.content.find(b => b.type === 'text')?.text ?? ''
}

async function runAiForMessage(raw: RawMessage, leadId: number | null): Promise<string | null> {
  if (!raw.text) return null  // no text → skip AI (photos/audio are still in AMO via note)

  const supabase = db()

  // Bot is temporarily disabled
  return null

  // Is this chat AI-managed?
  const { data: chat } = await supabase
    .from('ai_managed_chats')
    .select('*')
    .eq('chat_id', raw.chat_id)
    .maybeSingle()

  if (!chat || !chat.is_active) return null

  // Save incoming message to conversation history
  await supabase.from('ai_conversations').insert({
    chat_id: raw.chat_id, role: 'user', content: raw.text,
  })
  await supabase.from('ai_managed_chats')
    .update({ last_message_at: new Date().toISOString() })
    .eq('chat_id', raw.chat_id)

  // Build conversation history (last 20, chronological, deduped)
  const { data: history } = await supabase
    .from('ai_conversations')
    .select('role, content')
    .eq('chat_id', raw.chat_id)
    .order('created_at', { ascending: false })
    .limit(20)

  const chrono = (history ?? []).reverse()
  const deduped: typeof chrono = []
  for (const m of chrono) {
    if (deduped.length && deduped[deduped.length - 1].role === m.role) continue
    deduped.push(m)
  }
  while (deduped.length && deduped[0].role === 'assistant') deduped.shift()

  const messages: MessageParam[] = deduped.map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }))

  const rawReply = await generateAiReply(messages)
  const isMeasure  = rawReply.includes('[ЗАМЕР_ГОТОВ]')
  const needsHuman = rawReply.includes('[НУЖЕН_ЧЕЛОВЕК]')
  const reply = rawReply.replace(/\[ЗАМЕР_ГОТОВ\]/g, '').replace(/\[НУЖЕН_ЧЕЛОВЕК\]/g, '').trim()

  // Send reply via Wazzup; stamp last_bot_reply_at so echo detection works
  await sendMessage(raw.channel_id, raw.chat_id, raw.chat_type, reply)
  await supabase.from('ai_conversations').insert({ chat_id: raw.chat_id, role: 'assistant', content: reply })
  await supabase.from('ai_managed_chats').update({ last_bot_reply_at: new Date().toISOString() }).eq('chat_id', raw.chat_id)

  // Handle transfer triggers
  if (isMeasure || needsHuman) {
    await supabase.from('ai_managed_chats').update({
      is_active: false,
      close_reason: isMeasure ? 'measurement' : 'human',
    }).eq('chat_id', raw.chat_id)
    const effectiveLeadId = leadId ?? chat.amo_lead_id
    if (effectiveLeadId) {
      const taskText = isMeasure
        ? '✅ Клиент готов к замеру! AI-диалог завершён — позвонить и согласовать время'
        : '❓ AI не может помочь — клиент ожидает живого менеджера'
      await createAmoTask(effectiveLeadId, taskText)
    }
  }

  // Add full exchange to AMO note
  const effectiveLeadId = leadId ?? chat.amo_lead_id
  if (effectiveLeadId) {
    await addAmoNote(effectiveLeadId, `📱 Клиент: ${raw.text}\n🤖 Владислав: ${reply}`)
  }

  return reply
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
async function processItem(item: QueueItem): Promise<void> {
  const supabase = db()
  const newAttempts = item.attempts + 1

  // Mark as processing
  await supabase.from('message_queue').update({
    status: 'processing', attempts: newAttempts, updated_at: new Date().toISOString(),
  }).eq('id', item.id)

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
    return
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
    return
  }

  // ── Step 2: AI processing (non-blocking — CRM delivery already done) ────────
  let aiReply: string | null = null
  try {
    if (raw.direction === 'incoming' && raw.message_type !== 'system') {
      aiReply = await runAiForMessage(raw as RawMessage, leadId)
    }
    await supabase.from('message_queue').update({
      status: 'ai_processed',
      ai_response: aiReply,
      updated_at: new Date().toISOString(),
    }).eq('id', item.id)
  } catch (aiErr) {
    // AI failure is recorded but does NOT change the final status back to retry.
    // The message IS in AmoCRM. AI is an enhancement, not a gate.
    console.error(`[process-queue] AI failed for item ${item.id}:`, String(aiErr))
    await supabase.from('message_queue').update({
      status: 'synced_to_amocrm',  // already synced — keep this status
      last_error: `AI: ${String(aiErr)}`,
      updated_at: new Date().toISOString(),
    }).eq('id', item.id)
  }

  await supabase.from('avito_messages_raw').update({ processing_status: 'done' }).eq('id', raw.id)
}

// ── Cron entry point ──────────────────────────────────────────────────────────
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = db()
  const now = new Date().toISOString()

  // Pick pending items + retry_scheduled items whose retry time has passed
  const { data: items, error } = await supabase
    .from('message_queue')
    .select('id, raw_message_id, attempts, max_attempts, status')
    .or(`status.eq.pending,and(status.eq.retry_scheduled,next_retry_at.lte.${now})`)
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
      await processItem(item)
      results.push({ id: item.id, status: 'ok' })
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
