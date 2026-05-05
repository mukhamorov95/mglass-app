import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { sendMessage, getChannels } from '@/lib/wazzup'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
const AMO_BASE = `https://${process.env.AMO_SUBDOMAIN}.amocrm.ru/api/v4`
const AMO_TOKEN = process.env.AMO_ACCESS_TOKEN!
const VLADISLAV_USER_ID = parseInt(process.env.AMO_VLADISLAV_USER_ID || '8352283')

const ROUND_ROBIN_ENABLED = process.env.AMOCRM_ROUND_ROBIN_ENABLED === 'true'
const ROUND_ROBIN_MANAGERS: number[] = (process.env.AMOCRM_MANAGERS_IDS ?? '')
  .split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n > 0)

// Stage IDs — update if your pipeline uses different IDs
// Find them via: GET /api/v4/leads/pipelines
const STAGE_MEASUREMENT_SCHEDULED = process.env.AMO_STAGE_MEASUREMENT_ID
  ? parseInt(process.env.AMO_STAGE_MEASUREMENT_ID)
  : null

const FIRST_MESSAGE = `Здравствуйте! Меня зовут Владислав, я менеджер компании MGlass.

Вы оставили заявку на изготовление — уточните, пожалуйста, что именно вас интересует? Зеркало с подсветкой, душевая перегородка или лофт-перегородка?`

const MEASUREMENT_CONFIRMATION = `Отлично! Замер у вас назначен. Наш мастер приедет в согласованное время.

Если появятся вопросы — пишите сюда, всегда на связи 🙂`

function supabase() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function amoGet(path: string) {
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

async function getLeadPhone(leadId: number): Promise<{ phone: string; name: string } | null> {
  const data = await amoGet(`/leads/${leadId}?with=contacts`)
  const contacts = data?._embedded?.contacts
  if (!contacts?.length) return null

  for (const contact of contacts) {
    const contactData = await amoGet(`/contacts/${contact.id}`)
    const fields = contactData?.custom_fields_values ?? []
    const phoneField = fields.find((f: any) => f.field_code === 'PHONE')
    const phones = phoneField?.values ?? []
    if (phones.length) {
      const raw = phones[0].value as string
      const clean = raw.replace(/\D/g, '').replace(/^8/, '7')
      const name = contactData?.name ?? ''
      return { phone: clean, name }
    }
  }
  return null
}

async function getDefaultChannel(): Promise<{ channelId: string; chatType: string } | null> {
  try {
    const data = await getChannels()
    const channels = data?.channels ?? []
    const active = channels.find((c: any) => c.state === 'active')
    if (!active) return null
    return { channelId: active.id, chatType: active.transport ?? 'whatsapp' }
  } catch {
    return null
  }
}

async function getNextRoundRobinManager(): Promise<number | null> {
  if (!ROUND_ROBIN_ENABLED || !ROUND_ROBIN_MANAGERS.length) return null

  const db = supabase()
  const { data } = await db.from('ai_settings').select('value').eq('key', 'round_robin_index').single()
  const idx = parseInt(data?.value ?? '0') || 0
  const managerId = ROUND_ROBIN_MANAGERS[idx % ROUND_ROBIN_MANAGERS.length]
  const nextIdx = (idx + 1) % ROUND_ROBIN_MANAGERS.length
  await db.from('ai_settings').upsert({ key: 'round_robin_index', value: String(nextIdx), updated_at: new Date().toISOString() })
  return managerId
}

const STAGE_ASSIGNED = 48587215 // "Назначен ответственный" в воронке Продажи

async function assignLeadToManager(leadId: number, managerId: number) {
  await fetch(`${AMO_BASE}/leads`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${AMO_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([{ id: leadId, responsible_user_id: managerId, status_id: STAGE_ASSIGNED }]),
  })
}

async function handleNewLead(leadId: number, responsibleUserId: number) {
  if (responsibleUserId !== VLADISLAV_USER_ID) return

  const db = supabase()
  const phoneInfo = await getLeadPhone(leadId)
  if (!phoneInfo) return

  const channel = await getDefaultChannel()
  if (!channel) return

  const { phone, name } = phoneInfo
  const { channelId, chatType } = channel

  // Check if chat already exists
  const { data: existing } = await db
    .from('ai_managed_chats')
    .select('chat_id')
    .eq('chat_id', phone)
    .single()

  if (existing) return // Already managing this chat

  // Create managed chat record
  await db.from('ai_managed_chats').insert({
    chat_id: phone,
    channel_id: channelId,
    chat_type: chatType,
    amo_lead_id: leadId,
    client_name: name || null,
    is_active: true,
  })

  // Send first message
  await sendMessage(channelId, phone, chatType, FIRST_MESSAGE)

  // Save to conversation history
  await db.from('ai_conversations').insert({
    chat_id: phone,
    role: 'assistant',
    content: FIRST_MESSAGE,
  })

  await addAmoNote(leadId, `🤖 AI-менеджер начал диалог с клиентом`)
}

async function handleStageChange(leadId: number, newStatusId: number) {
  if (!STAGE_MEASUREMENT_SCHEDULED || newStatusId !== STAGE_MEASUREMENT_SCHEDULED) return

  const db = supabase()
  const { data: chat } = await db
    .from('ai_managed_chats')
    .select()
    .eq('amo_lead_id', leadId)
    .single()

  if (!chat) return

  await sendMessage(chat.channel_id, chat.chat_id, chat.chat_type, MEASUREMENT_CONFIRMATION)
  await db.from('ai_conversations').insert({
    chat_id: chat.chat_id,
    role: 'assistant',
    content: MEASUREMENT_CONFIRMATION,
  })
}

export async function POST(req: Request) {
  try {
    // AMO sends form-urlencoded data
    const contentType = req.headers.get('content-type') ?? ''
    let body: Record<string, unknown> = {}

    if (contentType.includes('application/json')) {
      body = await req.json()
    } else {
      // Parse form-urlencoded or query params
      const text = await req.text()
      const params = new URLSearchParams(text)
      for (const [key, value] of params.entries()) {
        body[key] = value
      }
    }

    // AMO webhook structure: leads[add][0][id], leads[status][0][id], etc.
    // Parse lead events
    const addMatches = JSON.stringify(body).match(/"leads\[add\]\[(\d+)\]\[id\]":"(\d+)"/g) ?? []
    const statusMatches = JSON.stringify(body).match(/"leads\[status\]\[(\d+)\]\[id\]":"(\d+)"/g) ?? []

    // Handle new leads
    for (const [key, value] of Object.entries(body)) {
      if (key.startsWith('leads[add]') && key.endsWith('[id]')) {
        const leadId = parseInt(value as string)
        if (leadId) {
          const lead = await amoGet(`/leads/${leadId}`)
          if (lead) {
            let managerId: number = lead.responsible_user_id
            const rrManager = await getNextRoundRobinManager()
            if (rrManager && rrManager !== managerId) {
              await assignLeadToManager(leadId, rrManager)
              await addAmoNote(leadId, `🔄 Round-robin: заявка назначена менеджеру ID ${rrManager}`)
              managerId = rrManager
            }
            await handleNewLead(leadId, managerId)
          }
        }
      }

      if (key.startsWith('leads[status]') && key.endsWith('[id]')) {
        const leadId = parseInt(value as string)
        const statusKey = key.replace('[id]', '[status_id]')
        const statusId = parseInt(body[statusKey] as string)
        if (leadId && statusId) {
          await handleStageChange(leadId, statusId)
        }
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('AMO webhook error:', err)
    return NextResponse.json({ ok: false }, { status: 200 })
  }
}
