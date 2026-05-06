import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import type { Tool, MessageParam } from '@anthropic-ai/sdk/resources/messages'
import {
  sendMessage, editMessage, answerCallback, getFileUrl, transcribeVoice,
  MAIN_MENU, type InlineKeyboard,
} from '@/lib/telegram'
import { quickCalc, type CalcType, type CalcOptions } from '@/lib/quickCalc'
import { sendMessage as sendWA } from '@/lib/wazzup'

export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// ─── Session helpers ────────────────────────────────────────────────────────

async function getSession(tid: number) {
  const supabase = db()
  const { data } = await supabase
    .from('telegram_sessions')
    .select('state, context')
    .eq('telegram_id', tid)
    .single()
  return data ?? { state: 'main_menu', context: {} }
}

async function setSession(tid: number, state: string, context: Record<string, unknown> = {}) {
  await db().from('telegram_sessions').upsert({ telegram_id: tid, state, context, updated_at: new Date().toISOString() })
}

async function getTelegramUser(tid: number) {
  const { data } = await db().from('telegram_users').select('user_id').eq('telegram_id', tid).single()
  return data
}

// ─── Calc tool for Claude ───────────────────────────────────────────────────

const CALC_TOOL: Tool = {
  name: 'calculate_price',
  description: 'Рассчитать стоимость изделия MGlass по размерам.',
  input_schema: {
    type: 'object' as const,
    properties: {
      type:    { type: 'string', enum: ['mirror', 'loft', 'shower'] },
      width:   { type: 'number', description: 'Ширина в мм' },
      height:  { type: 'number', description: 'Высота в мм' },
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

const PARSE_SYSTEM = `Ты помощник MGlass. Анализируй запрос пользователя на расчёт стоимости изделия.
Если есть конкретные размеры — сразу вызывай calculate_price.
Если размеров нет — спроси только: "Какой продукт и размеры?" (одним коротким вопросом).
Тип продукта: mirror=зеркало, loft=лофт-перегородка, shower=душевая перегородка.
Размеры всегда в мм. 100 см = 1000 мм.
Если пользователь говорит "монтаж" или "установка" — withMounting: true.
Для душевых: swing=распашная, sliding=раздвижная, fixed=неподвижная.`

async function runCalcChain(text: string): Promise<{ reply: string; hasResult: boolean }> {
  const messages: MessageParam[] = [{ role: 'user', content: text }]

  let response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    system: PARSE_SYSTEM,
    tools: [CALC_TOOL],
    messages,
  })

  for (let round = 0; round < 2 && response.stop_reason === 'tool_use'; round++) {
    const toolBlocks = response.content.filter(b => b.type === 'tool_use')
    const results = await Promise.all(toolBlocks.map(async (block) => {
      if (block.type !== 'tool_use') return null
      const input = block.input as { type: string; width: number; height: number; options?: CalcOptions }
      const result = await quickCalc(input.type as CalcType, input.width, input.height, input.options ?? {})
      if (!result) return { type: 'tool_result' as const, tool_use_id: block.id, content: 'Ошибка расчёта' }

      const fmt = (n: number) => n.toLocaleString('ru-RU') + ' ₽'
      const margin = result.price > 0 ? Math.round(((result.price - result.finalPrice) / result.price) * 100) : 0
      const statusIcon = margin >= 40 ? '🟢' : margin >= 30 ? '🟡' : '🔴'
      const mountLine = result.serviceLines?.find(s => s.name.toLowerCase().includes('монтаж'))
      const delivLine = result.serviceLines?.find(s => s.name.toLowerCase().includes('доставка'))

      const breakdown = [
        `Изделие — ${fmt(result.finalPrice)}`,
        mountLine ? `Монтаж — ${fmt(mountLine.total)}` : null,
        delivLine ? `Доставка — ${fmt(delivLine.total)}` : null,
        `<b>Итого — ${fmt(result.price)}</b>`,
        `Маржа: ${margin}% ${statusIcon}`,
      ].filter(Boolean).join('\n')

      return { type: 'tool_result' as const, tool_use_id: block.id, content: breakdown }
    }))

    const valid = results.filter(Boolean) as NonNullable<typeof results[0]>[]
    messages.push({ role: 'assistant', content: response.content })
    messages.push({ role: 'user', content: valid })

    response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      system: PARSE_SYSTEM,
      tools: [CALC_TOOL],
      messages,
    })
  }

  const text2 = response.content.find(b => b.type === 'text')?.text ?? ''
  const hasResult = text2.includes('Итого') || text2.includes('₽')
  return { reply: text2, hasResult }
}

// ─── Format leads list ──────────────────────────────────────────────────────

function leadsKeyboard(chats: any[], page: number): InlineKeyboard {
  const PAGE = 5
  const slice = chats.slice(page * PAGE, (page + 1) * PAGE)
  const rows: InlineKeyboard = slice.map(c => [{
    text: `${c.is_active ? '🟢' : '⚪'} ${c.client_name || c.chat_id} ${c.is_active ? '(AI)' : '(закрыт)'}`,
    callback_data: `lead:${c.chat_id}`,
  }])
  const nav: InlineButton[] = []
  if (page > 0) nav.push({ text: '◀ Назад', callback_data: `leads:page:${page - 1}` })
  if ((page + 1) * PAGE < chats.length) nav.push({ text: 'Вперёд ▶', callback_data: `leads:page:${page + 1}` })
  if (nav.length) rows.push(nav)
  rows.push([{ text: '🏠 Меню', callback_data: 'menu:main' }])
  return rows
}

// ─── Main handler ───────────────────────────────────────────────────────────

async function handle(update: any) {
  const msg = update.message
  const cb = update.callback_query
  const tid: number = (msg || cb.message).chat.id
  const chatId: number = tid
  const msgId: number | undefined = cb?.message?.message_id

  const tgUser = await getTelegramUser(tid)

  // ── Auth ──
  if (!tgUser) {
    if (msg?.text && /^\d{6}$/.test(msg.text.trim())) {
      const code = msg.text.trim()
      const supabase = db()
      const { data: codeRow } = await supabase
        .from('telegram_auth_codes')
        .select('user_id')
        .eq('code', code)
        .eq('used', false)
        .gt('expires_at', new Date().toISOString())
        .single()

      if (!codeRow) {
        await sendMessage(chatId, '❌ Код неверный или истёк. Попроси администратора создать новый.')
        return
      }

      await supabase.from('telegram_users').upsert({
        telegram_id: tid,
        user_id: codeRow.user_id,
        first_name: msg.from?.first_name ?? null,
        username: msg.from?.username ?? null,
      })
      await supabase.from('telegram_auth_codes').update({ used: true }).eq('code', code)
      await setSession(tid, 'main_menu')
      await sendMessage(chatId, `✅ Привязка успешна! Добро пожаловать в MGlass Assistant.`, MAIN_MENU)
    } else {
      await sendMessage(chatId, '👋 Привет! Введи <b>6-значный код</b> из MGlass → Пользователи → Telegram-код.')
    }
    return
  }

  const session = await getSession(tid)

  // ── Callback buttons ──
  if (cb) {
    await answerCallback(cb.id)
    const data: string = cb.data

    if (data === 'menu:main') {
      await editMessage(chatId, msgId!, '🏠 <b>Главное меню</b>', MAIN_MENU)
      await setSession(tid, 'main_menu')
      return
    }

    if (data === 'menu:calc') {
      await editMessage(chatId, msgId!, '🧮 <b>Расчёт цены</b>\n\nОпиши изделие и размеры текстом или голосом.\n\nПример: "Душевая 1000×2000 распашная с монтажом"')
      await setSession(tid, 'calc_input')
      return
    }

    if (data === 'menu:train') {
      await editMessage(chatId, msgId!, '🧠 <b>Задача для AI</b>\n\nОпиши текстом или голосом что нужно улучшить в AI-боте.')
      await setSession(tid, 'train_input')
      return
    }

    if (data === 'menu:leads' || data.startsWith('leads:page:')) {
      const page = data.startsWith('leads:page:') ? parseInt(data.split(':')[2]) : 0
      const { data: chats } = await db()
        .from('ai_managed_chats')
        .select('chat_id, client_name, is_active, last_message_at')
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(50)
      const list = chats ?? []
      if (!list.length) {
        await editMessage(chatId, msgId!, '📋 Нет активных лидов.', [[{ text: '🏠 Меню', callback_data: 'menu:main' }]])
        return
      }
      await editMessage(chatId, msgId!, `📋 <b>Лиды</b> (${list.length} шт)`, leadsKeyboard(list, page))
      await setSession(tid, 'leads_list', { page, chats: list.map(c => c.chat_id) })
      return
    }

    if (data === 'menu:msg') {
      const { data: chats } = await db()
        .from('ai_managed_chats')
        .select('chat_id, client_name, is_active, last_message_at')
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(50)
      const list = chats ?? []
      await editMessage(chatId, msgId!, `📋 <b>Выбери клиента:</b>`, leadsKeyboard(list, 0))
      await setSession(tid, 'msg_select_lead')
      return
    }

    if (data.startsWith('lead:') && !data.startsWith('lead:pause') && !data.startsWith('lead:resume') && !data.startsWith('lead:msg')) {
      const chatPhoneId = data.slice(5)
      const { data: chat } = await db()
        .from('ai_managed_chats')
        .select('*')
        .eq('chat_id', chatPhoneId)
        .single()
      if (!chat) { await answerCallback(cb.id, 'Не найдено'); return }

      const { data: lastMsgs } = await db()
        .from('ai_conversations')
        .select('role, content')
        .eq('chat_id', chatPhoneId)
        .order('created_at', { ascending: false })
        .limit(3)
      const history = (lastMsgs ?? []).reverse().map(m => `${m.role === 'user' ? '👤' : '🤖'} ${m.content}`).join('\n')

      const statusText = chat.is_active ? '🟢 AI активен' : `⚪ Закрыт (${chat.close_reason ?? '—'})`
      const text = [
        `<b>${chat.client_name || chat.chat_id}</b>`,
        `📱 ${chat.chat_id}`,
        statusText,
        '',
        history || '(нет сообщений)',
      ].join('\n')

      const keyboard: InlineKeyboard = [
        [
          { text: '💬 Написать', callback_data: `lead:msg:${chatPhoneId}` },
          chat.is_active
            ? { text: '⏸ Остановить AI', callback_data: `lead:pause:${chatPhoneId}` }
            : { text: '▶ Включить AI', callback_data: `lead:resume:${chatPhoneId}` },
        ],
        [{ text: '◀ К списку', callback_data: 'menu:leads' }],
      ]
      await editMessage(chatId, msgId!, text, keyboard)
      await setSession(tid, 'lead_detail', { chatPhoneId })
      return
    }

    if (data.startsWith('lead:pause:')) {
      const chatPhoneId = data.slice(11)
      await db().from('ai_managed_chats').update({ is_active: false, close_reason: 'human' }).eq('chat_id', chatPhoneId)
      await answerCallback(cb.id, '⏸ AI остановлен')
      // Refresh detail
      const fakeCb = { ...cb, data: `lead:${chatPhoneId}` }
      await handle({ callback_query: fakeCb })
      return
    }

    if (data.startsWith('lead:resume:')) {
      const chatPhoneId = data.slice(12)
      await db().from('ai_managed_chats').update({ is_active: true, close_reason: null }).eq('chat_id', chatPhoneId)
      await answerCallback(cb.id, '▶ AI включён')
      const fakeCb = { ...cb, data: `lead:${chatPhoneId}` }
      await handle({ callback_query: fakeCb })
      return
    }

    if (data.startsWith('lead:msg:')) {
      const chatPhoneId = data.slice(9)
      await editMessage(chatId, msgId!, `💬 Введи сообщение для клиента <b>${chatPhoneId}</b>.\n\nМожно текстом или голосом.`)
      await setSession(tid, 'lead_send_msg', { chatPhoneId })
      return
    }

    if (data === 'calc:save') {
      const ctx = session.context as any
      if (ctx?.calcText) {
        await db().from('ai_training_tasks').insert({
          title: 'Сохранённый расчёт из Telegram',
          description: ctx.calcText,
          source_text: ctx.calcText,
          category: 'calculation',
          created_by: tgUser.user_id,
        })
      }
      await answerCallback(cb.id, '✅ Сохранено в историю')
      await editMessage(chatId, msgId!, `✅ Расчёт сохранён.\n\n${ctx?.calcText ?? ''}`, [[{ text: '🏠 Меню', callback_data: 'menu:main' }]])
      return
    }

    return
  }

  // ── Text / Voice ──
  let inputText = msg?.text ?? ''

  if (msg?.voice || msg?.audio) {
    const fileId = msg.voice?.file_id ?? msg.audio?.file_id
    await sendMessage(chatId, '🎙 Распознаю голос...')
    try {
      inputText = await transcribeVoice(fileId)
      await sendMessage(chatId, `📝 <i>${inputText}</i>`)
    } catch {
      await sendMessage(chatId, '❌ Не удалось распознать голос. Попробуй ещё раз.', [[{ text: '🏠 Меню', callback_data: 'menu:main' }]])
      return
    }
  }

  if (!inputText) return

  // State-based routing
  const state = session.state

  if (state === 'main_menu' || state === 'leads_list') {
    await sendMessage(chatId, '🏠 Главное меню', MAIN_MENU)
    await setSession(tid, 'main_menu')
    return
  }

  if (state === 'calc_input') {
    const waiting = await sendMessage(chatId, '⏳ Считаю...') as any
    const { reply, hasResult } = await runCalcChain(inputText)
    const keyboard: InlineKeyboard = hasResult
      ? [
          [{ text: '💾 Сохранить', callback_data: 'calc:save' }],
          [{ text: '🔄 Ещё расчёт', callback_data: 'menu:calc' }, { text: '🏠 Меню', callback_data: 'menu:main' }],
        ]
      : [[{ text: '🏠 Меню', callback_data: 'menu:main' }]]
    await sendMessage(chatId, reply, keyboard)
    await setSession(tid, hasResult ? 'main_menu' : 'calc_input', { calcText: reply })
    return
  }

  if (state === 'train_input') {
    await sendMessage(chatId, '⏳ Сохраняю...')
    // Use Claude to classify and title the task
    const classifyResp = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 200,
      system: 'Classify this AI improvement task. Respond with JSON only: {"title":"short title in Russian","category":"tone|closing|objections|pricing|product|other"}',
      messages: [{ role: 'user', content: inputText }],
    })
    let title = inputText.slice(0, 80)
    let category = 'other'
    try {
      const raw = classifyResp.content.find(b => b.type === 'text')?.text ?? '{}'
      const parsed = JSON.parse(raw.match(/\{.*\}/s)?.[0] ?? '{}')
      title = parsed.title ?? title
      category = parsed.category ?? category
    } catch {}

    await db().from('ai_training_tasks').insert({
      title,
      description: inputText,
      source_text: inputText,
      category,
      priority: 'normal',
      status: 'pending',
      created_by: tgUser.user_id,
    })

    await sendMessage(chatId,
      `✅ <b>Задача AI сохранена:</b>\n\n${title}\n\n<i>Категория: ${category}</i>`,
      [
        [{ text: '➕ Ещё задача', callback_data: 'menu:train' }, { text: '🏠 Меню', callback_data: 'menu:main' }],
      ]
    )
    await setSession(tid, 'main_menu')
    return
  }

  if (state === 'lead_send_msg') {
    const ctx = session.context as any
    const chatPhoneId: string = ctx.chatPhoneId
    const { data: chat } = await db().from('ai_managed_chats').select('channel_id, chat_type').eq('chat_id', chatPhoneId).single()
    if (!chat) {
      await sendMessage(chatId, '❌ Чат не найден.', [[{ text: '🏠 Меню', callback_data: 'menu:main' }]])
      return
    }
    await sendWA(chat.channel_id, chatPhoneId, chat.chat_type, inputText)
    await db().from('ai_conversations').insert({ chat_id: chatPhoneId, role: 'assistant', content: inputText })
    await sendMessage(chatId,
      `✅ Сообщение отправлено клиенту!\n\n<i>${inputText}</i>`,
      [[{ text: '◀ К клиенту', callback_data: `lead:${chatPhoneId}` }, { text: '🏠 Меню', callback_data: 'menu:main' }]]
    )
    await setSession(tid, 'main_menu')
    return
  }

  // Default: show menu
  await sendMessage(chatId, '🏠 Главное меню', MAIN_MENU)
  await setSession(tid, 'main_menu')
}

export async function POST(req: Request) {
  // Verify secret token
  const secret = req.headers.get('x-telegram-bot-api-secret-token')
  if (process.env.TELEGRAM_WEBHOOK_SECRET && secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ ok: true }) // silent ignore
  }

  try {
    const update = await req.json()
    await handle(update)
  } catch (err) {
    console.error('Telegram webhook error:', err)
  }

  return NextResponse.json({ ok: true })
}
