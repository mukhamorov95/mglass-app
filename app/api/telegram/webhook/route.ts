import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import type { Tool, MessageParam } from '@anthropic-ai/sdk/resources/messages'
import {
  sendMessage, editMessage, answerCallback, transcribeVoice,
  MAIN_MENU, type InlineKeyboard, type InlineButton,
} from '@/lib/telegram'
import { quickCalc, type CalcType, type CalcOptions } from '@/lib/quickCalc'
import { sendMessage as sendWA } from '@/lib/wazzup'

export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

function withTimeout<T>(p: Promise<T>, ms: number, label = ''): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout:${label || ms}`)), ms)
    ),
  ])
}

// ─── Session helpers ────────────────────────────────────────────────────────

async function getSession(tid: number) {
  const { data } = await db().from('telegram_sessions').select('state, context').eq('telegram_id', tid).single()
  return data ?? { state: 'main_menu', context: {} }
}

async function setSession(tid: number, state: string, context: Record<string, unknown> = {}) {
  await db().from('telegram_sessions').upsert({ telegram_id: tid, state, context, updated_at: new Date().toISOString() })
}

async function getTelegramUser(tid: number) {
  const { data } = await db().from('telegram_users').select('user_id').eq('telegram_id', tid).single()
  return data
}

// ─── Calc tool ───────────────────────────────────────────────────────────────

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

const PARSE_SYSTEM = `Ты — парсер запросов MGlass. Задача: извлечь параметры и вызвать calculate_price.

Правила:
- Есть размеры → вызывай calculate_price немедленно
- Нет размеров → задай ОДИН вопрос: "Укажи размеры (ширина × высота в мм)"
- Размеры в мм. 100 см = 1000 мм
- mirror=зеркало, loft=лофт-перегородка, shower=душевая перегородка
- hasLighting=true ТОЛЬКО если клиент прямо сказал "подсветка" / "LED" / "с подсветкой"
- withMounting=true ТОЛЬКО если сказал "монтаж" / "установка" / "с монтажом"
- Не добавляй опции которые не упомянуты явно`

async function runCalcChain(text: string): Promise<{ reply: string; hasResult: boolean }> {
  const messages: MessageParam[] = [{ role: 'user', content: text }]

  const response = await withTimeout(
    anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      system: PARSE_SYSTEM,
      tools: [CALC_TOOL],
      tool_choice: { type: 'auto' },
      messages,
    }),
    20000,
    'claude-parse'
  )

  // Claude asked a clarifying question
  if (response.stop_reason !== 'tool_use') {
    const question = response.content.find(b => b.type === 'text')?.text ?? 'Укажи размеры (ширина × высота в мм).'
    return { reply: question, hasResult: false }
  }

  // Tool called — calculate and format deterministically
  const toolBlock = response.content.find(b => b.type === 'tool_use')
  if (!toolBlock || toolBlock.type !== 'tool_use') {
    return { reply: 'Укажи размеры (ширина × высота в мм).', hasResult: false }
  }

  const input = toolBlock.input as { type: string; width: number; height: number; options?: CalcOptions }
  const result = await withTimeout(
    quickCalc(input.type as CalcType, input.width, input.height, input.options ?? {}),
    8000,
    'quickCalc'
  )

  if (!result) return { reply: '❌ Не удалось рассчитать. Проверь параметры и попробуй снова.', hasResult: false }

  const fmt = (n: number) => n.toLocaleString('ru-RU') + ' ₽'
  const margin = result.price > 0 ? Math.round(((result.price - result.finalPrice) / result.price) * 100) : 0
  const icon = margin >= 40 ? '🟢' : margin >= 30 ? '🟡' : '🔴'

  // Client text from calculator (deterministic — no AI invention)
  const reply = [
    result.description,
    '',
    `📊 <i>Маржа: ${margin}% ${icon} | Цена: ${fmt(result.price)}</i>`,
  ].join('\n')

  return { reply, hasResult: true }
}

// ─── Format leads keyboard ───────────────────────────────────────────────────

function leadsKeyboard(chats: any[], page: number): InlineKeyboard {
  const PAGE = 5
  const slice = chats.slice(page * PAGE, (page + 1) * PAGE)
  const rows: InlineKeyboard = slice.map(c => [{
    text: `${c.is_active ? '🟢' : '⚪'} ${c.client_name || c.chat_id}`,
    callback_data: `lead:${c.chat_id}`,
  }])
  const nav: InlineButton[] = []
  if (page > 0) nav.push({ text: '◀ Назад', callback_data: `leads:page:${page - 1}` })
  if ((page + 1) * PAGE < chats.length) nav.push({ text: 'Вперёд ▶', callback_data: `leads:page:${page + 1}` })
  if (nav.length) rows.push(nav)
  rows.push([{ text: '🏠 Меню', callback_data: 'menu:main' }])
  return rows
}

// ─── /health ─────────────────────────────────────────────────────────────────

async function handleHealth(chatId: number) {
  const checks: string[] = ['🔧 <b>Статус MGlass Bot</b>\n']

  try {
    await withTimeout(Promise.resolve(db().from('telegram_sessions').select('telegram_id').limit(1)), 4000, 'supabase')
    checks.push('✅ Supabase — подключён')
  } catch {
    checks.push('❌ Supabase — ошибка подключения')
  }

  checks.push(process.env.ANTHROPIC_API_KEY ? '✅ Anthropic — ключ задан' : '❌ Anthropic — ключ не задан')
  checks.push(process.env.OPENAI_API_KEY ? '✅ OpenAI (голос) — ключ задан' : '⚠️ OpenAI (голос) — ключ не задан')
  checks.push(process.env.TELEGRAM_BOT_TOKEN ? '✅ Telegram token — задан' : '❌ Telegram token — не задан')
  checks.push('✅ Webhook — активен')

  await sendMessage(chatId, checks.join('\n'), [[{ text: '🏠 Меню', callback_data: 'menu:main' }]])
}

// ─── /debug ──────────────────────────────────────────────────────────────────

async function handleDebug(chatId: number, tid: number) {
  const tgUser = await getTelegramUser(tid)
  const session = await getSession(tid)

  const lines = [
    '🔍 <b>Debug Info</b>\n',
    `Telegram ID: <code>${tid}</code>`,
    `Авторизован: ${tgUser ? '✅ да' : '❌ нет'}`,
    `Состояние: <code>${session.state}</code>`,
    `Контекст: <code>${JSON.stringify(session.context).slice(0, 100)}</code>`,
    '',
    `OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? '✅' : '❌'}`,
    `ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? '✅' : '❌'}`,
    `TELEGRAM_BOT_TOKEN: ${process.env.TELEGRAM_BOT_TOKEN ? '✅' : '❌'}`,
    `SUPABASE_URL: ${process.env.NEXT_PUBLIC_SUPABASE_URL ? '✅' : '❌'}`,
  ]

  await sendMessage(chatId, lines.join('\n'), [[{ text: '🏠 Меню', callback_data: 'menu:main' }]])
}

// ─── Main handler ─────────────────────────────────────────────────────────────

async function handle(update: any) {
  const msg = update.message
  const cb = update.callback_query
  if (!msg && !cb) return

  const tid: number = (msg ?? cb.message).chat.id
  const chatId = tid

  console.log(`[TG] update tid=${tid} type=${msg ? 'msg' : 'cb'}`)

  // /health доступна без авторизации
  if (msg?.text) {
    const cmd = msg.text.trim().split(/[\s@]/)[0].toLowerCase()
    if (cmd === '/health') { await handleHealth(chatId); return }
  }

  // Auth check
  const tgUser = await getTelegramUser(tid)

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
      return
    }

    await sendMessage(chatId, '🔒 Введи <b>6-значный код</b> из MGlass (Admin → Пользователи → кнопка TG).')
    return
  }

  console.log(`[TG] authorized user_id=${tgUser.user_id}`)

  const session = await getSession(tid)

  // ── Команды для авторизованных ──
  if (msg?.text) {
    const cmd = msg.text.trim().split(/[\s@]/)[0].toLowerCase()
    if (cmd === '/start' || cmd === '/menu') {
      await sendMessage(chatId, '🏠 <b>Главное меню</b>', MAIN_MENU)
      await setSession(tid, 'main_menu')
      return
    }
    if (cmd === '/debug') { await handleDebug(chatId, tid); return }
  }

  // ── Callback buttons ──
  if (cb) {
    await answerCallback(cb.id)
    const data: string = cb.data
    const msgId: number = cb.message.message_id

    if (data === 'menu:main') {
      await editMessage(chatId, msgId, '🏠 <b>Главное меню</b>', MAIN_MENU)
      await setSession(tid, 'main_menu')
      return
    }

    if (data === 'menu:calc') {
      await editMessage(chatId, msgId, '🧮 <b>Расчёт цены</b>\n\nОпиши изделие и размеры текстом или голосом.\n\nПример: <i>Душевая 1000×2000 распашная с монтажом</i>')
      await setSession(tid, 'calc_input')
      return
    }

    if (data === 'menu:train') {
      await editMessage(chatId, msgId, '🧠 <b>Задача для AI</b>\n\nОпиши текстом или голосом что нужно улучшить в AI-боте.')
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
        await editMessage(chatId, msgId, '📋 Нет активных лидов.', [[{ text: '🏠 Меню', callback_data: 'menu:main' }]])
        return
      }
      await editMessage(chatId, msgId, `📋 <b>Лиды</b> (${list.length} шт)`, leadsKeyboard(list, page))
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
      await editMessage(chatId, msgId, `📋 <b>Выбери клиента:</b>`, leadsKeyboard(list, 0))
      await setSession(tid, 'msg_select_lead')
      return
    }

    if (data.startsWith('lead:') && !data.startsWith('lead:pause') && !data.startsWith('lead:resume') && !data.startsWith('lead:msg')) {
      const chatPhoneId = data.slice(5)
      const { data: chat } = await db().from('ai_managed_chats').select('*').eq('chat_id', chatPhoneId).single()
      if (!chat) { await answerCallback(cb.id, 'Не найдено'); return }

      const { data: lastMsgs } = await db()
        .from('ai_conversations')
        .select('role, content')
        .eq('chat_id', chatPhoneId)
        .order('created_at', { ascending: false })
        .limit(3)
      const history = (lastMsgs ?? []).reverse().map(m => `${m.role === 'user' ? '👤' : '🤖'} ${m.content}`).join('\n')

      const statusText = chat.is_active ? '🟢 AI активен' : `⚪ Закрыт (${chat.close_reason ?? '—'})`
      const text = [`<b>${chat.client_name || chat.chat_id}</b>`, `📱 ${chat.chat_id}`, statusText, '', history || '(нет сообщений)'].join('\n')

      const keyboard: InlineKeyboard = [
        [
          { text: '💬 Написать', callback_data: `lead:msg:${chatPhoneId}` },
          chat.is_active
            ? { text: '⏸ Остановить AI', callback_data: `lead:pause:${chatPhoneId}` }
            : { text: '▶ Включить AI', callback_data: `lead:resume:${chatPhoneId}` },
        ],
        [{ text: '◀ К списку', callback_data: 'menu:leads' }],
      ]
      await editMessage(chatId, msgId, text, keyboard)
      await setSession(tid, 'lead_detail', { chatPhoneId })
      return
    }

    if (data.startsWith('lead:pause:')) {
      const chatPhoneId = data.slice(11)
      await db().from('ai_managed_chats').update({ is_active: false, close_reason: 'human' }).eq('chat_id', chatPhoneId)
      await answerCallback(cb.id, '⏸ AI остановлен')
      await handle({ callback_query: { ...cb, data: `lead:${chatPhoneId}` } })
      return
    }

    if (data.startsWith('lead:resume:')) {
      const chatPhoneId = data.slice(12)
      await db().from('ai_managed_chats').update({ is_active: true, close_reason: null }).eq('chat_id', chatPhoneId)
      await answerCallback(cb.id, '▶ AI включён')
      await handle({ callback_query: { ...cb, data: `lead:${chatPhoneId}` } })
      return
    }

    if (data.startsWith('lead:msg:')) {
      const chatPhoneId = data.slice(9)
      await editMessage(chatId, msgId, `💬 Введи сообщение для клиента <b>${chatPhoneId}</b>.\n\nМожно текстом или голосом.`)
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
      await answerCallback(cb.id, '✅ Сохранено')
      await editMessage(chatId, msgId, `✅ Расчёт сохранён.`, [[{ text: '🏠 Меню', callback_data: 'menu:main' }]])
      return
    }

    return
  }

  // ── Text / Voice ──
  let inputText = msg?.text ?? ''

  if (msg?.voice || msg?.audio) {
    if (!process.env.OPENAI_API_KEY) {
      await sendMessage(chatId,
        '⚠️ Голосовое распознавание пока не настроено.\n\nОтправь запрос текстом.',
        [[{ text: '🏠 Меню', callback_data: 'menu:main' }]]
      )
      return
    }

    const fileId = msg.voice?.file_id ?? msg.audio?.file_id
    const statusMsg = await sendMessage(chatId, '🎙 Распознаю голос...') as any
    const statusMsgId = statusMsg?.result?.message_id

    try {
      console.log(`[TG] voice transcription start tid=${tid}`)
      inputText = await withTimeout(transcribeVoice(fileId), 30000, 'whisper')
      console.log(`[TG] voice transcription done: "${inputText.slice(0, 60)}"`)

      if (statusMsgId) {
        await editMessage(chatId, statusMsgId, `📝 <i>${inputText}</i>`)
      }
    } catch (err) {
      console.error(`[TG] voice error:`, err)
      const isTimeout = err instanceof Error && err.message.startsWith('timeout')
      const text = isTimeout
        ? '⏱ Распознавание заняло слишком долго. Попробуй ещё раз или отправь текстом.'
        : '❌ Не удалось распознать голос. Проверь соединение или отправь текстом.'
      if (statusMsgId) {
        await editMessage(chatId, statusMsgId, text, [[{ text: '🏠 Меню', callback_data: 'menu:main' }]])
      } else {
        await sendMessage(chatId, text, [[{ text: '🏠 Меню', callback_data: 'menu:main' }]])
      }
      return
    }
  }

  if (!inputText) return

  const state = session.state

  if (state === 'main_menu' || state === 'leads_list') {
    await sendMessage(chatId, '🏠 <b>Главное меню</b>', MAIN_MENU)
    await setSession(tid, 'main_menu')
    return
  }

  if (state === 'calc_input') {
    console.log(`[TG] calc start: "${inputText.slice(0, 60)}"`)
    const waitMsg = await sendMessage(chatId, '⏳ Считаю...') as any
    const waitMsgId = waitMsg?.result?.message_id

    try {
      const { reply, hasResult } = await runCalcChain(inputText)
      console.log(`[TG] calc done hasResult=${hasResult}`)

      const keyboard: InlineKeyboard = hasResult
        ? [[{ text: '💾 Сохранить', callback_data: 'calc:save' }], [{ text: '🔄 Ещё расчёт', callback_data: 'menu:calc' }, { text: '🏠 Меню', callback_data: 'menu:main' }]]
        : [[{ text: '🏠 Меню', callback_data: 'menu:main' }]]

      if (waitMsgId) {
        await editMessage(chatId, waitMsgId, reply, keyboard)
      } else {
        await sendMessage(chatId, reply, keyboard)
      }
      await setSession(tid, hasResult ? 'main_menu' : 'calc_input', { calcText: reply })
    } catch (err) {
      console.error(`[TG] calc error:`, err)
      const isTimeout = err instanceof Error && err.message.startsWith('timeout')
      const errText = isTimeout
        ? '⏱ Расчёт занял слишком долго. Попробуй ещё раз.'
        : '❌ Не удалось выполнить расчёт. Попробуй перефразировать запрос.'
      const kb: InlineKeyboard = [[{ text: '🔄 Попробовать', callback_data: 'menu:calc' }, { text: '🏠 Меню', callback_data: 'menu:main' }]]
      if (waitMsgId) {
        await editMessage(chatId, waitMsgId, errText, kb)
      } else {
        await sendMessage(chatId, errText, kb)
      }
    }
    return
  }

  if (state === 'train_input') {
    const waitMsg = await sendMessage(chatId, '⏳ Сохраняю...') as any
    const waitMsgId = waitMsg?.result?.message_id

    try {
      const classifyResp = await withTimeout(
        anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 200,
          system: 'Classify this AI improvement task. Respond with JSON only: {"title":"short title in Russian","category":"tone|closing|objections|pricing|product|other"}',
          messages: [{ role: 'user', content: inputText }],
        }),
        15000,
        'claude-classify'
      )

      let title = inputText.slice(0, 80)
      let category = 'other'
      try {
        const raw = classifyResp.content.find(b => b.type === 'text')?.text ?? '{}'
        const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? '{}')
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

      const resultText = `✅ <b>Задача AI сохранена:</b>\n\n${title}\n\n<i>Категория: ${category}</i>`
      const kb: InlineKeyboard = [[{ text: '➕ Ещё задача', callback_data: 'menu:train' }, { text: '🏠 Меню', callback_data: 'menu:main' }]]

      if (waitMsgId) {
        await editMessage(chatId, waitMsgId, resultText, kb)
      } else {
        await sendMessage(chatId, resultText, kb)
      }
      await setSession(tid, 'main_menu')
    } catch (err) {
      console.error(`[TG] train error:`, err)
      const errText = '❌ Не удалось сохранить задачу. Попробуй ещё раз.'
      if (waitMsgId) {
        await editMessage(chatId, waitMsgId, errText, [[{ text: '🏠 Меню', callback_data: 'menu:main' }]])
      } else {
        await sendMessage(chatId, errText, [[{ text: '🏠 Меню', callback_data: 'menu:main' }]])
      }
    }
    return
  }

  if (state === 'lead_send_msg') {
    const ctx = session.context as any
    const chatPhoneId: string = ctx.chatPhoneId

    try {
      const { data: chat } = await db().from('ai_managed_chats').select('channel_id, chat_type').eq('chat_id', chatPhoneId).single()
      if (!chat) throw new Error('chat not found')
      await sendWA(chat.channel_id, chatPhoneId, chat.chat_type, inputText)
      await db().from('ai_conversations').insert({ chat_id: chatPhoneId, role: 'assistant', content: inputText })
      await sendMessage(chatId,
        `✅ Сообщение отправлено!\n\n<i>${inputText}</i>`,
        [[{ text: '◀ К клиенту', callback_data: `lead:${chatPhoneId}` }, { text: '🏠 Меню', callback_data: 'menu:main' }]]
      )
    } catch (err) {
      console.error(`[TG] lead_send error:`, err)
      await sendMessage(chatId, '❌ Не удалось отправить сообщение.', [[{ text: '🏠 Меню', callback_data: 'menu:main' }]])
    }
    await setSession(tid, 'main_menu')
    return
  }

  await sendMessage(chatId, '🏠 <b>Главное меню</b>', MAIN_MENU)
  await setSession(tid, 'main_menu')
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const secret = req.headers.get('x-telegram-bot-api-secret-token')
  if (process.env.TELEGRAM_WEBHOOK_SECRET && secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ ok: true })
  }

  let update: any
  try {
    update = await req.json()
  } catch {
    return NextResponse.json({ ok: true })
  }

  // Отвечаем Telegram сразу, обрабатываем в фоне
  after(async () => {
    try {
      await handle(update)
    } catch (err) {
      console.error('[TG] unhandled error:', err)
    }
  })

  return NextResponse.json({ ok: true })
}
