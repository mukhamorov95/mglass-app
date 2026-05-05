import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import type { Tool, MessageParam } from '@anthropic-ai/sdk/resources/messages'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { sendMessage } from '@/lib/wazzup'
import { quickCalc, type CalcType, type CalcOptions } from '@/lib/quickCalc'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
const AMO_BASE = `https://${process.env.AMO_SUBDOMAIN}.amocrm.ru/api/v4`
const AMO_TOKEN = process.env.AMO_ACCESS_TOKEN!
const VLADISLAV_USER_ID = parseInt(process.env.AMO_VLADISLAV_USER_ID || '8352283')

const SYSTEM = `Ты — Владислав. Пишешь клиентам в WhatsApp от своего лица — живо, уверенно, по-человечески. Не бот, не менеджер по скрипту. Просто человек который разбирается в продукте и реально хочет помочь.

MGlass — своё производство в Москве: зеркала с LED, лофт-перегородки, душевые. Гарантия 2 года, монтаж включён, срок 14 дней.

═══ КАК ВЕСТИ ДИАЛОГ ═══
1. Понять задачу клиента — 1 вопрос, не анкета
2. Уточнить размер если нет — это нужно для цены
3. Когда есть размеры — вызвать calculate_price и назвать цену естественно
4. Закрыть на бесплатный замер

═══ КАК НАЗЫВАТЬ ЦЕНУ ═══
ВСЕГДА показывай разбивку тремя строками — изделие, монтаж, доставка — и отдельно итого.
Пример: "Зеркало — 25 000 ₽, монтаж — 3 000 ₽, доставка по МКАД — 2 000 ₽. Итого 30 000 ₽"
Пиши это разговорно, но три строки должны быть всегда — клиент сам видит из чего складывается цена.
Не говори "считал", "по калькулятору", "выходит" — просто называй цифры уверенно.
Никогда не пиши звёздочки **вот так** — это WhatsApp, не документ.

═══ ГОЛОС И СТИЛЬ ═══
• Разговорный русский — как пишут друзьям, не в деловой переписке
• Максимум 2-3 коротких предложения. Часто хватает одного.
• Цену округляй: 27 тысяч, а не 27 333 ₽ (точную называй только если спрашивают)
• Без официоза: не "уважаемый", не "благодарю за обращение", не "с уважением"
• 1 эмодзи максимум — только если реально уместно

═══ ПРИЁМЫ ═══
Цена названа → сразу: "Давайте замерщика пришлю, он всё уточнит на месте — это бесплатно"
"Дорого" → "А с чем сравниваете? У нас своё производство, без наценок посредника"
"Подумаю" → "Что именно обдумываете — может сразу отвечу?"
"Дешевле нашёл" → "Интересно, где? Важно понять что сравниваем — у нас монтаж и гарантия уже в цене"
"КП пришлите" → "Пришлю. Хотя честно — точная цена только после замера, там видно все нюансы. Замер бесплатный, хотите запишем?"

Добавь [ЗАМЕР_ГОТОВ] ТОЛЬКО если клиент в своём последнем сообщении явно согласился на замер — сказал "да", "давайте", "запишите", "хорошо", "окей", "согласен" или подобное. Если ты сам предлагаешь замер и ждёшь ответа — НЕ добавляй тег.
Добавь [НУЖЕН_ЧЕЛОВЕК] только если клиент прямо просит живого менеджера или ты не можешь ответить на вопрос.`

const CALC_TOOL: Tool = {
  name: 'calculate_price',
  description: 'Рассчитать точную стоимость изделия через калькулятор MGlass по размерам клиента. Вызывай всегда, когда клиент называет конкретные размеры.',
  input_schema: {
    type: 'object' as const,
    properties: {
      type: {
        type: 'string',
        enum: ['mirror', 'loft', 'shower'],
        description: 'mirror — зеркало, loft — лофт-перегородка, shower — душевая перегородка',
      },
      width: { type: 'number', description: 'Ширина в мм (например 1000 для 100 см)' },
      height: { type: 'number', description: 'Высота в мм (например 2000 для 200 см)' },
      options: {
        type: 'object',
        description: 'Дополнительные параметры',
        properties: {
          hasLighting: { type: 'boolean', description: 'Нужна ли подсветка (для зеркала, по умолчанию true)' },
          withMounting: { type: 'boolean', description: 'Нужен ли монтаж' },
          model: { type: 'string', description: 'Модель душевой: M1-M12' },
          tier: { type: 'string', enum: ['budget', 'standard'], description: 'Класс душевой' },
          sections: { type: 'number', description: 'Количество секций лофт-перегородки' },
          systemType: { type: 'string', enum: ['fixed', 'sliding', 'swing'], description: 'Тип открывания лофт' },
        },
      },
    },
    required: ['type', 'width', 'height'],
  },
}

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

function buildPriceBreakdown(result: { finalPrice: number; price: number; description: string; serviceLines?: Array<{ name: string; total: number }> }): string {
  const fmt = (n: number) => n.toLocaleString('ru-RU') + ' ₽'

  const productLine = `Изделие — ${fmt(result.finalPrice)}`

  const mountingSvc = result.serviceLines?.find(s => s.name.toLowerCase().includes('монтаж'))
  const mountingLine = mountingSvc
    ? `Монтаж — ${fmt(mountingSvc.total)}`
    : 'Монтаж — уточним на замере'

  const deliverySvc = result.serviceLines?.find(s => s.name.toLowerCase().includes('доставка'))
  const deliveryLine = deliverySvc
    ? `Доставка — ${fmt(deliverySvc.total)}`
    : 'Доставка по МКАД — уточним'

  const totalLine = `Итого — ${fmt(result.price)}`

  return `Данные из калькулятора:\n${productLine}\n${mountingLine}\n${deliveryLine}\n${totalLine}\n\nПокажи клиенту именно эти три строки (изделие, монтаж, доставка) и итого — в своём разговорном стиле.`
}

async function getExtraKnowledge(): Promise<string> {
  try {
    const db = supabase()
    const { data } = await db.from('ai_settings').select('value').eq('key', 'bot_extra_knowledge').single()
    return data?.value?.trim() || ''
  } catch { return '' }
}

async function generateAiResponse(messages: MessageParam[]): Promise<string> {
  const extra = await getExtraKnowledge()
  const system = extra
    ? `${SYSTEM}\n\n═══ ДОПОЛНИТЕЛЬНЫЕ ЗНАНИЯ (обновляются автоматически) ═══\n${extra}`
    : SYSTEM

  let response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    system,
    tools: [CALC_TOOL],
    messages,
  })

  // Handle tool_use loop (max 2 rounds)
  for (let round = 0; round < 2 && response.stop_reason === 'tool_use'; round++) {
    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use')
    const toolResults = await Promise.all(
      toolUseBlocks.map(async (block) => {
        if (block.type !== 'tool_use') return null
        const input = block.input as { type: string; width: number; height: number; options?: CalcOptions }
        const result = await quickCalc(
          input.type as CalcType,
          input.width,
          input.height,
          input.options ?? {},
        )
        return {
          type: 'tool_result' as const,
          tool_use_id: block.id,
          content: result
            ? buildPriceBreakdown(result)
            : 'Ошибка расчёта — используй приблизительную цену из памяти',
        }
      })
    )

    const validResults = toolResults.filter((r): r is NonNullable<typeof r> => r !== null)
    messages = [
      ...messages,
      { role: 'assistant' as const, content: response.content },
      { role: 'user' as const, content: validResults },
    ]

    response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      system,
      tools: [CALC_TOOL],
      messages,
    })
  }

  return response.content.find(b => b.type === 'text')?.text ?? ''
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

  // Save user message and update stats
  await Promise.all([
    db.from('ai_conversations').insert({ chat_id: chatId, role: 'user', content: text }),
    db.from('ai_managed_chats').update({ last_message_at: new Date().toISOString() }).eq('chat_id', chatId),
  ])

  // Get history (last 20 messages)
  const { data: history } = await db
    .from('ai_conversations')
    .select('role, content')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: true })
    .limit(20)

  const messages: MessageParam[] = (history || []).map((m: { role: string; content: string }) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }))

  const rawResponse = await generateAiResponse(messages)
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
    await db.from('ai_managed_chats').update({
      is_active: false,
      close_reason: isMeasureReady ? 'measurement' : 'human',
    }).eq('chat_id', chatId)
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
