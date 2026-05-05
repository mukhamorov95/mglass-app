import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { sendMessage } from '@/lib/wazzup'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
const AMO_BASE = `https://${process.env.AMO_SUBDOMAIN}.amocrm.ru/api/v4`
const AMO_TOKEN = process.env.AMO_ACCESS_TOKEN!
const VLADISLAV_USER_ID = parseInt(process.env.AMO_VLADISLAV_USER_ID || '8352283')

const SYSTEM = `Ты — Владислав, менеджер по продажам компании MGlass (Москва).

MGlass производит:
- Зеркала с LED-подсветкой: сенсорные, антизапотевание, разные размеры. Цены от 8 000 до 60 000+ руб.
- Лофт-перегородки: металл + стекло, цвета RAL. Цены от 30 000 до 300 000+ руб.
- Душевые перегородки: безрамные и с профилем. Цены от 20 000 до 150 000+ руб.
Производство своё в Москве, гарантия 2 года, монтаж входит в стоимость, срок 14 дней.

ЗАДАЧА: квалифицировать клиента → дать предварительную стоимость → закрыть на БЕСПЛАТНЫЙ ЗАМЕР.

СТИЛЬ: пиши как живой человек. Коротко — максимум 2-3 предложения. Без официоза. Используй имя если знаешь.

СПЕЦКОМАНДЫ (добавь в конец ответа если нужно):
[ЗАМЕР_ГОТОВ] — если клиент согласился на замер
[НУЖЕН_ЧЕЛОВЕК] — если вопрос слишком сложный или клиент агрессивен`

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

async function createAmoTask(leadId: number, text: string) {
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
      responsible_user_id: VLADISLAV_USER_ID,
    }]),
  })
}

async function findLeadByPhone(phone: string): Promise<{ id: number; responsible_user_id: number } | null> {
  const clean = phone.replace(/\D/g, '').replace(/^8/, '7')
  const data = await amoGet(`/contacts?query=${clean}&with=leads`)
  const contacts = data?._embedded?.contacts
  if (!contacts?.length) return null
  const leads = contacts[0]?._embedded?.leads
  if (!leads?.length) return null
  const leadId = leads[leads.length - 1].id
  const lead = await amoGet(`/leads/${leadId}`)
  if (!lead) return null
  return { id: lead.id, responsible_user_id: lead.responsible_user_id }
}

async function processMessage(msg: {
  chatId: string
  channelId: string
  chatType: string
  text: string
  contactName?: string
}) {
  const db = supabase()
  const { chatId, channelId, chatType, text, contactName } = msg

  // Find or create managed chat
  let { data: chat } = await db
    .from('ai_managed_chats')
    .select()
    .eq('chat_id', chatId)
    .single()

  if (!chat) {
    const lead = await findLeadByPhone(chatId)
    // Only handle if lead is assigned to Vladislav
    if (!lead || lead.responsible_user_id !== VLADISLAV_USER_ID) return

    const { data } = await db.from('ai_managed_chats').insert({
      chat_id: chatId,
      channel_id: channelId,
      chat_type: chatType,
      amo_lead_id: lead.id,
      client_name: contactName || null,
      is_active: true,
    }).select().single()
    chat = data
  } else if (!chat.is_active) {
    return // Already handed off to human
  }

  // Save user message
  await db.from('ai_conversations').insert({ chat_id: chatId, role: 'user', content: text })

  // Get history (last 20 messages)
  const { data: history } = await db
    .from('ai_conversations')
    .select('role, content')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: true })
    .limit(20)

  const messages = (history || []).map((m: { role: string; content: string }) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }))

  // Generate AI response
  const aiMsg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    system: SYSTEM,
    messages,
  })

  const rawResponse = aiMsg.content[0].type === 'text' ? aiMsg.content[0].text : ''
  const isMeasureReady = rawResponse.includes('[ЗАМЕР_ГОТОВ]')
  const needsHuman = rawResponse.includes('[НУЖЕН_ЧЕЛОВЕК]')
  const cleanResponse = rawResponse
    .replace(/\[ЗАМЕР_ГОТОВ\]/g, '')
    .replace(/\[НУЖЕН_ЧЕЛОВЕК\]/g, '')
    .trim()

  // Send reply
  await sendMessage(channelId, chatId, chatType, cleanResponse)

  // Save assistant message
  await db.from('ai_conversations').insert({ chat_id: chatId, role: 'assistant', content: cleanResponse })

  // Handle transfer triggers
  if (isMeasureReady || needsHuman) {
    await db.from('ai_managed_chats').update({ is_active: false }).eq('chat_id', chatId)
    if (chat.amo_lead_id) {
      const taskText = isMeasureReady
        ? `✅ Клиент готов к замеру! AI-диалог завершён — позвонить и согласовать время`
        : `❓ AI не может помочь — клиент ожидает живого менеджера`
      await createAmoTask(chat.amo_lead_id, taskText)
    }
  }

  // Add note to AMO
  if (chat.amo_lead_id) {
    await addAmoNote(chat.amo_lead_id, `📱 Клиент: ${text}\n🤖 Владислав: ${cleanResponse}`)
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const messages: any[] = body.messages || []

    // Log to Supabase for debugging
    const db = supabase()
    await db.from('ai_managed_chats').upsert({
      chat_id: '__debug__',
      channel_id: 'debug',
      chat_type: 'debug',
      client_name: JSON.stringify({ count: messages.length, first: messages[0] ?? null }),
      is_active: false,
    })

    for (const msg of messages) {
      // Skip non-text and system messages
      if (!msg.text || msg.type === 'system') continue
      // Skip outgoing/echo (our own sent messages)
      if (msg.isEcho === true || msg.author === 'operator' || msg.incoming === false || msg.isOutgoing === true) continue

      await processMessage({
        chatId: msg.chatId,
        channelId: msg.channelId,
        chatType: msg.chatType || 'whatsapp',
        text: msg.text,
        contactName: msg.contact?.name,
      })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Wazzup webhook error:', err)
    return NextResponse.json({ ok: false }, { status: 200 })
  }
}
