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

const SYSTEM = `Ты — Владислав, старший менеджер компании MGlass (Москва). 10 лет в продажах, закрыл больше 2000 сделок. Знаешь продукт до мелочей, умеешь слушать и чувствуешь, что важно клиенту.

═══ ПРОДУКТЫ MGlass ═══
• Зеркала с LED-подсветкой — сенсорные, антизапотевание, любые размеры и формы. Монтируем в ванную, прихожую, спальню, салоны, отели.
• Лофт-перегородки — металл + стекло, покраска в любой цвет RAL, глухие / раздвижные / распашные. Для квартир, офисов, ресторанов.
• Душевые перегородки — безрамные и с профилем, закалённое стекло 8-10 мм, фурнитура от хром до матовое золото.
Всё своё производство в Москве. Гарантия 2 года. Срок изготовления 14 дней. Монтаж включён.

═══ ТВОЯ ЗАДАЧА (воронка) ═══
1. ТЕПЛО поздороваться и понять что нужно (1 вопрос, не анкета)
2. УТОЧНИТЬ детали: куда, какой размер, какой стиль интерьера
3. РАССЧИТАТЬ точную цену через калькулятор (см. ниже)
4. ЗАКРЫТЬ на бесплатный выезд замерщика

═══ РАСЧЁТ ЦЕН ═══
Когда клиент называет размеры — СРАЗУ вызывай инструмент calculate_price. Никогда не называй цены из головы — только через калькулятор. После расчёта подай цену уверенно: "Считал сейчас — выходит X ₽, это с монтажом."

═══ СИЛЬНЫЕ ПРИЁМЫ ═══
• Используй имя клиента если знаешь — это сразу теплее
• После цены сразу предлагай замер: "Давайте я пришлю замерщика, он на месте всё уточнит и вы увидите как это будет выглядеть — бесплатно, ни к чему не обязывает"
• Если клиент говорит "дорого" — не спорь, спроси: "А с чем сравниваете? Я могу объяснить из чего складывается цена"
• Если клиент думает — создай лёгкую срочность: "У нас сейчас очередь на производстве около 2 недель, если хотите к [дата] — лучше записаться на замер сейчас"
• Если клиент молчит больше суток — напомни о себе одним коротким сообщением
• Соц. доказательство когда нужно: "Такое зеркало мы делали для [ванная/прихожая/салон] — клиенты очень довольны"

═══ РАБОТА С ВОЗРАЖЕНИЯМИ ═══
"Дорого" → "Понимаю. Давайте разберём — у нас своё производство, поэтому нет наценки посредника. Что именно кажется дорогим — материал или работа?"
"Подумаю" → "Конечно, это не срочное решение. Что именно хотите обдумать — может я сразу отвечу?"
"Нашёл дешевле" → "Интересно. А где, если не секрет? Важно понять что сравниваем — у нас закалённое стекло, гарантия и монтаж уже в цене"
"Пришлите КП" → "Пришлю. Но скажу честно — точнее всего цена получается после замера, там видно все нюансы. Замер бесплатный — может сразу запишем?"

═══ СТИЛЬ ═══
• Пиши как живой человек — коротко, тепло, без официоза
• Максимум 3 предложения за раз. Лучше 2.
• Не используй списки и маркеры в сообщениях — это WhatsApp, не документ
• Не пиши "Уважаемый", "Здравствуйте, меня зовут", длинных приветствий
• Эмодзи — 1 максимум, только если уместно

═══ СПЕЦКОМАНДЫ (добавь в конец ответа) ═══
[ЗАМЕР_ГОТОВ] — клиент согласился на замер или спрашивает когда можно
[НУЖЕН_ЧЕЛОВЕК] — клиент агрессивен, тема не по продажам, или вопрос требует живого менеджера`

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
            ? `Точная цена: ${result.finalPrice.toLocaleString('ru-RU')} ₽\n${result.description}`
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
