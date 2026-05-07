import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import type { Tool } from '@anthropic-ai/sdk/resources/messages'
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
  return data ?? { state: 'main_menu', context: {} as Record<string, unknown> }
}

async function setSession(tid: number, state: string, context: Record<string, unknown> = {}) {
  await db().from('telegram_sessions').upsert({ telegram_id: tid, state, context, updated_at: new Date().toISOString() })
}

async function getTelegramUser(tid: number) {
  const { data } = await db().from('telegram_users').select('user_id').eq('telegram_id', tid).single()
  return data
}

// ─── Parsed calc input type ──────────────────────────────────────────────────

type ParsedCalcInput = {
  type: CalcType
  width: number
  height: number
  options: CalcOptions
}

// ─── Parameter extraction tool ───────────────────────────────────────────────

const PARSE_TOOL: Tool = {
  name: 'extract_params',
  description: 'Извлечь параметры изделия из запроса.',
  input_schema: {
    type: 'object' as const,
    properties: {
      type:         { type: 'string', enum: ['mirror', 'loft', 'shower'], description: 'Тип изделия' },
      width:        { type: 'number', description: 'Ширина в мм (для круга — диаметр)' },
      height:       { type: 'number', description: 'Высота в мм (для круга = ширина)' },
      shape:        { type: 'string', enum: ['rectangle', 'circle', 'oval'], description: 'Форма. circle — если сказано "круглое/круг/round"' },
      mirrorType:   { type: 'string', enum: ['silver', 'crystal_vision'], description: 'crystal_vision — только если сказано "осветлённое/crystal vision/crystalvision". Иначе silver.' },
      hasLighting:  { type: 'boolean', description: 'true ТОЛЬКО если явно: "подсветка/LED/Aura/с подсветкой"' },
      hasSandblast: { type: 'boolean', description: 'true ТОЛЬКО если: "пескоструй/матирование/рисунок"' },
      buttonType:   { type: 'string', enum: ['none', 'sensor', 'wave'], description: 'wave — датчик взмаха, sensor — сенсорная кнопка' },
      withMounting: { type: 'boolean', description: 'true ТОЛЬКО если: "монтаж/установка/с монтажом"' },
      model:        { type: 'string', description: 'Модель душевой: M1–M12' },
      tier:         { type: 'string', enum: ['budget', 'standard'], description: 'Класс душевой' },
      hardwareColor: { type: 'string', description: 'Цвет фурнитуры: chrome/black/gold/brass' },
      systemType:   { type: 'string', enum: ['fixed', 'sliding', 'swing'], description: 'swing=распашная, sliding=раздвижная, fixed=неподвижная' },
      sections:     { type: 'number', description: 'Секций лофт-перегородки' },
    },
    required: ['type', 'width', 'height'],
  },
}

const PARSE_SYSTEM = `Ты — строгий парсер параметров MGlass. Задача: извлечь параметры и вызвать extract_params.

ПРАВИЛА (нарушение недопустимо):
- Есть тип + размеры → сразу вызывай extract_params
- Нет размеров → спроси только: "Укажи размеры (ширина × высота в мм)"
- Размеры в мм. 100 см = 1000 мм. 80 см = 800 мм.

ФОРМА ЗЕРКАЛА:
- "круглое/круг/round/круглой формы" → shape: circle, width = height = диаметр
- "овальное/oval" → shape: oval
- Всё остальное → shape: rectangle (не указывай если прямоугольник)

МАТЕРИАЛ ЗЕРКАЛА:
- "осветлённое/осветленное/crystal vision/crystalvision/crystal" → mirrorType: crystal_vision
- Всё остальное → mirrorType: silver (или не указывай)

ПОДСВЕТКА:
- ТОЛЬКО "подсветка/LED/Aura/с подсветкой/по периметру" → hasLighting: true
- Без упоминания → НЕ включать

МОНТАЖ:
- ТОЛЬКО "монтаж/установка/с монтажом/повесить" → withMounting: true
- Без упоминания → НЕ включать

ЗАПРЕЩЕНО добавлять параметры которые пользователь не упоминал.`

// ─── Normalization ───────────────────────────────────────────────────────────

function normalizeInput(raw: Record<string, unknown>): ParsedCalcInput {
  const type = raw.type as CalcType
  let width  = Number(raw.width)  || 0
  let height = Number(raw.height) || 0
  const shape = raw.shape as CalcOptions['shape'] | undefined

  // Нормализация синонимов цвета фурнитуры
  const colorMap: Record<string, string> = {
    'черн': 'black', 'black': 'black',
    'хром': 'chrome', 'chrome': 'chrome', 'серебр': 'chrome',
    'золот': 'gold', 'gold': 'gold',
    'брасс': 'brass', 'латунь': 'brass',
  }
  let hardwareColor = raw.hardwareColor as string | undefined
  if (hardwareColor) {
    const lc = hardwareColor.toLowerCase()
    hardwareColor = Object.entries(colorMap).find(([k]) => lc.includes(k))?.[1] ?? hardwareColor
  }

  // Для круга ширина = высота = диаметр
  if (shape === 'circle') {
    const d = Math.max(width, height)
    width = height = d
  }

  // Круг/овал → подложка обязательна (как на веб-платформе)
  const isRound = shape === 'circle' || shape === 'oval'

  const options: CalcOptions = {
    shape,
    hasSubstrate: isRound || undefined,
    mirrorType:   raw.mirrorType   as CalcOptions['mirrorType']   | undefined,
    hasLighting:  Boolean(raw.hasLighting),
    hasSandblast: Boolean(raw.hasSandblast),
    buttonType:   (raw.buttonType  as CalcOptions['buttonType'])  ?? 'none',
    withMounting: Boolean(raw.withMounting),
    model:        raw.model        as string | undefined,
    tier:         raw.tier         as CalcOptions['tier']         | undefined,
    hardwareColor,
    systemType:   raw.systemType   as CalcOptions['systemType']   | undefined,
    sections:     raw.sections     ? Number(raw.sections)         : undefined,
  }

  // Убираем undefined-поля
  Object.keys(options).forEach(k => {
    if (options[k as keyof CalcOptions] === undefined) delete options[k as keyof CalcOptions]
  })

  return { type, width, height, options }
}

// ─── Parsed params summary ───────────────────────────────────────────────────

function formatConfirmText(p: ParsedCalcInput, originalText?: string): string {
  const typeLabels: Record<string, string> = {
    mirror: '🪞 Зеркало', shower: '🚿 Душевая', loft: '🏗 Лофт',
  }
  const shapeLabels: Record<string, string> = {
    circle: 'круглое', oval: 'овальное', rectangle: 'прямоугольное',
  }
  const systemLabels: Record<string, string> = {
    fixed: 'неподвижная', sliding: 'раздвижная', swing: 'распашная',
  }

  const lines: string[] = ['📋 <b>Я понял запрос так:</b>\n']
  lines.push(`Изделие: <b>${typeLabels[p.type] ?? p.type}</b>`)

  if (p.type === 'mirror') {
    const shape = p.options.shape ?? 'rectangle'
    lines.push(`Форма: <b>${shapeLabels[shape]}</b>`)
    if (shape === 'circle') {
      lines.push(`Диаметр: <b>Ø${p.width} мм</b>`)
    } else {
      lines.push(`Размер: <b>${p.width} × ${p.height} мм</b>`)
    }
    lines.push(`Материал: <b>${p.options.mirrorType === 'crystal_vision' ? 'Crystal Vision (осветлённое)' : 'Silver (стандарт)'}</b>`)
    if (p.options.hasSubstrate) lines.push('Подложка: <b>включена ✓</b>')
    if (p.options.hasLighting)  lines.push('Подсветка: <b>Aura ✓</b>')
    if (p.options.hasSandblast) lines.push('Пескоструй: <b>да ✓</b>')
    if (p.options.buttonType === 'wave')   lines.push('Кнопка: <b>датчик взмаха ✓</b>')
    if (p.options.buttonType === 'sensor') lines.push('Кнопка: <b>сенсорная ✓</b>')
  } else if (p.type === 'shower') {
    lines.push(`Размер: <b>${p.width} × ${p.height} мм</b>`)
    if (p.options.model)       lines.push(`Модель: <b>${p.options.model}</b>`)
    if (p.options.tier)        lines.push(`Класс: <b>${p.options.tier === 'budget' ? 'Бюджет' : 'Стандарт'}</b>`)
    if (p.options.hardwareColor) lines.push(`Фурнитура: <b>${p.options.hardwareColor}</b>`)
    if (p.options.systemType)  lines.push(`Тип: <b>${systemLabels[p.options.systemType!]}</b>`)
  } else if (p.type === 'loft') {
    lines.push(`Размер: <b>${p.width} × ${p.height} мм</b>`)
    if (p.options.sections)    lines.push(`Секций: <b>${p.options.sections}</b>`)
    if (p.options.systemType)  lines.push(`Тип: <b>${systemLabels[p.options.systemType!]}</b>`)
  }

  if (p.options.withMounting) lines.push('Монтаж: <b>включён ✓</b>')

  lines.push('\nВсё верно?')
  return lines.join('\n')
}

// ─── Calculation & result formatting ─────────────────────────────────────────

async function runCalc(p: ParsedCalcInput): Promise<{ reply: string; hasResult: boolean; margin: number }> {
  const result = await withTimeout(
    quickCalc(p.type, p.width, p.height, p.options),
    12000, 'quickCalc'
  )
  if (!result) return { reply: '❌ Не удалось рассчитать. Проверь параметры.', hasResult: false, margin: 0 }

  const icon = result.margin >= 40 ? '🟢' : result.margin >= 30 ? '🟡' : '🔴'
  const fmt  = (n: number) => n.toLocaleString('ru-RU') + ' ₽'

  const reply = [
    result.description,
    '',
    `📊 <i>Маржа: ${result.margin}% ${icon} | Итого: ${fmt(result.price)}</i>`,
  ].join('\n')

  return { reply, hasResult: true, margin: result.margin }
}

// ─── Claude parameter extraction ─────────────────────────────────────────────

async function parseCalcInput(text: string): Promise<ParsedCalcInput | string> {
  const response = await withTimeout(
    anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      system: PARSE_SYSTEM,
      tools: [PARSE_TOOL],
      tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: text }],
    }),
    20000, 'claude-parse'
  )

  if (response.stop_reason !== 'tool_use') {
    return response.content.find(b => b.type === 'text')?.text ?? 'Укажи тип изделия и размеры (ширина × высота в мм).'
  }

  const block = response.content.find(b => b.type === 'tool_use')
  if (!block || block.type !== 'tool_use') {
    return 'Укажи тип изделия и размеры (ширина × высота в мм).'
  }

  return normalizeInput(block.input as Record<string, unknown>)
}

// ─── Leads keyboard ───────────────────────────────────────────────────────────

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

// ─── /health ──────────────────────────────────────────────────────────────────

async function handleHealth(chatId: number) {
  const checks: string[] = ['🔧 <b>Статус MGlass Bot</b>\n']
  try {
    await withTimeout(Promise.resolve(db().from('telegram_sessions').select('telegram_id').limit(1)), 4000, 'supabase')
    checks.push('✅ Supabase — подключён')
  } catch {
    checks.push('❌ Supabase — ошибка')
  }
  checks.push(process.env.ANTHROPIC_API_KEY ? '✅ Anthropic — ключ задан' : '❌ Anthropic — ключ не задан')
  checks.push(process.env.OPENAI_API_KEY    ? '✅ OpenAI (голос) — ключ задан' : '⚠️ OpenAI — ключ не задан (голос недоступен)')
  checks.push(process.env.TELEGRAM_BOT_TOKEN ? '✅ Telegram token — задан' : '❌ Telegram token — не задан')
  checks.push('✅ Webhook — активен')
  await sendMessage(chatId, checks.join('\n'), [[{ text: '🏠 Меню', callback_data: 'menu:main' }]])
}

// ─── /debug & /debug_last ─────────────────────────────────────────────────────

async function handleDebug(chatId: number, tid: number) {
  const tgUser  = await getTelegramUser(tid)
  const session = await getSession(tid)
  const lines = [
    '🔍 <b>Debug Info</b>\n',
    `Telegram ID: <code>${tid}</code>`,
    `Авторизован: ${tgUser ? '✅' : '❌'}`,
    `Состояние: <code>${session.state}</code>`,
    `OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? '✅' : '❌'}`,
    `ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? '✅' : '❌'}`,
    `TELEGRAM_BOT_TOKEN: ${process.env.TELEGRAM_BOT_TOKEN ? '✅' : '❌'}`,
  ]
  await sendMessage(chatId, lines.join('\n'), [[{ text: '📋 Последний расчёт', callback_data: 'debug:last' }, { text: '🏠 Меню', callback_data: 'menu:main' }]])
}

async function handleDebugLast(chatId: number, tid: number) {
  const session = await getSession(tid)
  const d = (session.context as any)?.lastDebug as Record<string, unknown> | undefined
  if (!d) {
    await sendMessage(chatId, '📋 Нет данных о последнем расчёте.', [[{ text: '🏠 Меню', callback_data: 'menu:main' }]])
    return
  }
  const lines = [
    '📋 <b>Последний расчёт — отладка</b>\n',
    d.transcription ? `🎙 Транскрипция:\n<i>${d.transcription}</i>\n` : null,
    d.parsed ? `🔍 Распознано:\n<code>${JSON.stringify(d.parsed, null, 2)}</code>\n` : null,
    d.margin !== undefined ? `📊 Маржа: ${d.margin}%` : null,
    d.error ? `❌ Ошибка: <code>${d.error}</code>` : null,
  ].filter(Boolean).join('\n')
  await sendMessage(chatId, lines, [[{ text: '🏠 Меню', callback_data: 'menu:main' }]])
}

// ─── Main handler ─────────────────────────────────────────────────────────────

async function handle(update: any) {
  const msg = update.message
  const cb  = update.callback_query
  if (!msg && !cb) return

  const tid    = (msg ?? cb.message).chat.id as number
  const chatId = tid

  console.log(`[TG] tid=${tid} type=${msg ? 'msg' : 'cb'}`)

  // /health без авторизации
  if (msg?.text) {
    const cmd = msg.text.trim().split(/[\s@]/)[0].toLowerCase()
    if (cmd === '/health') { await handleHealth(chatId); return }
  }

  const tgUser = await getTelegramUser(tid)

  // ── Неавторизованный ──
  if (!tgUser) {
    if (msg?.text && /^\d{6}$/.test(msg.text.trim())) {
      const code    = msg.text.trim()
      const supabase = db()
      const { data: codeRow } = await supabase
        .from('telegram_auth_codes').select('user_id')
        .eq('code', code).eq('used', false)
        .gt('expires_at', new Date().toISOString()).single()

      if (!codeRow) {
        await sendMessage(chatId, '❌ Код неверный или истёк. Попроси администратора создать новый.')
        return
      }
      await supabase.from('telegram_users').upsert({
        telegram_id: tid, user_id: codeRow.user_id,
        first_name: msg.from?.first_name ?? null, username: msg.from?.username ?? null,
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

  // ── Команды авторизованного ──
  if (msg?.text) {
    const cmd = msg.text.trim().split(/[\s@]/)[0].toLowerCase()
    if (cmd === '/start' || cmd === '/menu') {
      await sendMessage(chatId, '🏠 <b>Главное меню</b>', MAIN_MENU)
      await setSession(tid, 'main_menu')
      return
    }
    if (cmd === '/debug')      { await handleDebug(chatId, tid); return }
    if (cmd === '/debug_last') { await handleDebugLast(chatId, tid); return }
  }

  // ── Callback buttons ──
  if (cb) {
    await answerCallback(cb.id)
    const data: string  = cb.data
    const msgId: number = cb.message.message_id

    if (data === 'menu:main') {
      await editMessage(chatId, msgId, '🏠 <b>Главное меню</b>', MAIN_MENU)
      await setSession(tid, 'main_menu')
      return
    }

    if (data === 'menu:calc') {
      await editMessage(chatId, msgId, '🧮 <b>Расчёт цены</b>\n\nОпиши изделие и размеры текстом или голосом.\n\n<i>Пример: Душевая 1000×2000 распашная с монтажом</i>')
      await setSession(tid, 'calc_input')
      return
    }

    if (data === 'menu:train') {
      await editMessage(chatId, msgId, '🧠 <b>Задача для AI</b>\n\nОпиши что нужно улучшить в боте.')
      await setSession(tid, 'train_input')
      return
    }

    if (data === 'menu:leads' || data.startsWith('leads:page:')) {
      const page = data.startsWith('leads:page:') ? parseInt(data.split(':')[2]) : 0
      const { data: chats } = await db()
        .from('ai_managed_chats').select('chat_id, client_name, is_active, last_message_at')
        .order('last_message_at', { ascending: false, nullsFirst: false }).limit(50)
      const list = chats ?? []
      if (!list.length) {
        await editMessage(chatId, msgId, '📋 Нет активных лидов.', [[{ text: '🏠 Меню', callback_data: 'menu:main' }]])
        return
      }
      await editMessage(chatId, msgId, `📋 <b>Лиды</b> (${list.length})`, leadsKeyboard(list, page))
      await setSession(tid, 'leads_list', { page })
      return
    }

    if (data === 'menu:msg') {
      const { data: chats } = await db()
        .from('ai_managed_chats').select('chat_id, client_name, is_active, last_message_at')
        .order('last_message_at', { ascending: false, nullsFirst: false }).limit(50)
      const list = chats ?? []
      await editMessage(chatId, msgId, '📋 <b>Выбери клиента:</b>', leadsKeyboard(list, 0))
      await setSession(tid, 'msg_select_lead')
      return
    }

    if (data.startsWith('lead:') && !data.startsWith('lead:pause') && !data.startsWith('lead:resume') && !data.startsWith('lead:msg')) {
      const chatPhoneId = data.slice(5)
      const { data: chat } = await db().from('ai_managed_chats').select('*').eq('chat_id', chatPhoneId).single()
      if (!chat) return

      const { data: lastMsgs } = await db().from('ai_conversations')
        .select('role, content').eq('chat_id', chatPhoneId)
        .order('created_at', { ascending: false }).limit(3)
      const history = (lastMsgs ?? []).reverse().map(m => `${m.role === 'user' ? '👤' : '🤖'} ${m.content}`).join('\n')

      const text = [
        `<b>${chat.client_name || chat.chat_id}</b>`, `📱 ${chat.chat_id}`,
        chat.is_active ? '🟢 AI активен' : `⚪ Закрыт (${chat.close_reason ?? '—'})`,
        '', history || '(нет сообщений)',
      ].join('\n')

      const keyboard: InlineKeyboard = [
        [
          { text: '💬 Написать', callback_data: `lead:msg:${chatPhoneId}` },
          chat.is_active
            ? { text: '⏸ Остановить AI', callback_data: `lead:pause:${chatPhoneId}` }
            : { text: '▶ Включить AI',   callback_data: `lead:resume:${chatPhoneId}` },
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
      await editMessage(chatId, msgId, `💬 Введи сообщение для <b>${chatPhoneId}</b>. Текстом или голосом.`)
      await setSession(tid, 'lead_send_msg', { chatPhoneId })
      return
    }

    // ── Calc confirm / reenter ──
    if (data === 'calc:confirm') {
      const ctx = session.context as any
      const parsed = ctx?.parsedInput as ParsedCalcInput | undefined
      if (!parsed) {
        await editMessage(chatId, msgId, '❌ Параметры устарели. Введи запрос заново.', [[{ text: '🧮 Расчёт', callback_data: 'menu:calc' }]])
        return
      }

      const waitMsg = await sendMessage(chatId, '⏳ Считаю...') as any
      const waitMsgId = waitMsg?.result?.message_id

      try {
        console.log('[TG] calc confirmed, running quickCalc')
        const { reply, hasResult, margin } = await runCalc(parsed)
        console.log(`[TG] calc done margin=${margin}`)

        const keyboard: InlineKeyboard = hasResult
          ? [[{ text: '💾 Сохранить', callback_data: 'calc:save' }], [{ text: '🔄 Ещё', callback_data: 'menu:calc' }, { text: '🏠 Меню', callback_data: 'menu:main' }]]
          : [[{ text: '🏠 Меню', callback_data: 'menu:main' }]]

        if (waitMsgId) await editMessage(chatId, waitMsgId, reply, keyboard)
        else await sendMessage(chatId, reply, keyboard)

        // Save debug + update session
        const newCtx = { ...ctx, lastDebug: { ...((ctx.lastDebug as any) ?? {}), margin, calcResult: reply } }
        await setSession(tid, hasResult ? 'main_menu' : 'calc_input', { ...newCtx, calcText: reply })
      } catch (err) {
        console.error('[TG] calc error:', err)
        const isTimeout = err instanceof Error && err.message.startsWith('timeout')
        const errText = isTimeout ? '⏱ Расчёт занял слишком долго. Попробуй снова.' : '❌ Ошибка расчёта. Попробуй снова.'
        const kb: InlineKeyboard = [[{ text: '🔄 Попробовать', callback_data: 'menu:calc' }, { text: '🏠 Меню', callback_data: 'menu:main' }]]
        if (waitMsgId) await editMessage(chatId, waitMsgId, errText, kb)
        else await sendMessage(chatId, errText, kb)
        await setSession(tid, 'calc_input', { ...session.context, lastDebug: { error: String(err) } })
      }
      return
    }

    if (data === 'calc:reenter') {
      await editMessage(chatId, msgId, '🧮 <b>Расчёт цены</b>\n\nОпиши изделие заново. Например:\n<i>Круглое зеркало 800 мм</i>\n<i>Душевая 900×2000 распашная с монтажом</i>')
      await setSession(tid, 'calc_input')
      return
    }

    if (data === 'calc:save') {
      const ctx = session.context as any
      if (ctx?.calcText) {
        await db().from('ai_training_tasks').insert({
          title: 'Расчёт из Telegram', description: ctx.calcText,
          source_text: ctx.calcText, category: 'calculation', created_by: tgUser.user_id,
        })
      }
      await answerCallback(cb.id, '✅ Сохранено')
      await editMessage(chatId, msgId, '✅ Расчёт сохранён.', [[{ text: '🏠 Меню', callback_data: 'menu:main' }]])
      return
    }

    if (data === 'debug:last') {
      await handleDebugLast(chatId, tid)
      return
    }

    return
  }

  // ── Text / Voice ──
  let inputText    = msg?.text ?? ''
  let transcription: string | undefined

  if (msg?.voice || msg?.audio) {
    if (!process.env.OPENAI_API_KEY) {
      await sendMessage(chatId, '⚠️ Голосовое распознавание не настроено. Отправь текстом.', [[{ text: '🏠 Меню', callback_data: 'menu:main' }]])
      return
    }
    const fileId   = msg.voice?.file_id ?? msg.audio?.file_id
    const statusMsg = await sendMessage(chatId, '🎙 Распознаю голос...') as any
    const statusMsgId = statusMsg?.result?.message_id

    try {
      console.log(`[TG] voice transcription start tid=${tid}`)
      inputText = await withTimeout(transcribeVoice(fileId), 30000, 'whisper')
      transcription = inputText
      console.log(`[TG] voice done: "${inputText.slice(0, 60)}"`)
      if (statusMsgId) await editMessage(chatId, statusMsgId, `🎙 Распознал: <i>${inputText}</i>`)
    } catch (err) {
      console.error('[TG] voice error:', err)
      const isTimeout = err instanceof Error && err.message.startsWith('timeout')
      const text = isTimeout ? '⏱ Распознавание заняло слишком долго.' : '❌ Не удалось распознать голос.'
      if (statusMsgId) await editMessage(chatId, statusMsgId, `${text} Попробуй текстом.`, [[{ text: '🏠 Меню', callback_data: 'menu:main' }]])
      else await sendMessage(chatId, `${text} Попробуй текстом.`, [[{ text: '🏠 Меню', callback_data: 'menu:main' }]])
      return
    }
  }

  if (!inputText) return

  const state = session.state

  // Голосовое из любого состояния → всегда идём в расчёт
  const effectiveState = transcription ? 'calc_input' : state

  if (effectiveState === 'main_menu' || effectiveState === 'leads_list') {
    await sendMessage(chatId, '🏠 <b>Главное меню</b>', MAIN_MENU)
    await setSession(tid, 'main_menu')
    return
  }

  // ── Расчёт: парсинг → подтверждение ──
  if (effectiveState === 'calc_input') {
    const thinkMsg  = await sendMessage(chatId, '🔍 Распознаю параметры...') as any
    const thinkMsgId = thinkMsg?.result?.message_id

    try {
      console.log(`[TG] parsing: "${inputText.slice(0, 60)}"`)
      const parseResult = await parseCalcInput(inputText)

      if (typeof parseResult === 'string') {
        // Claude задал уточняющий вопрос
        if (thinkMsgId) await editMessage(chatId, thinkMsgId, parseResult, [[{ text: '🏠 Меню', callback_data: 'menu:main' }]])
        else await sendMessage(chatId, parseResult, [[{ text: '🏠 Меню', callback_data: 'menu:main' }]])
        return
      }

      console.log(`[TG] parsed:`, JSON.stringify(parseResult))

      const confirmText = formatConfirmText(parseResult, inputText)
      const keyboard: InlineKeyboard = [
        [{ text: '✅ Считать', callback_data: 'calc:confirm' }, { text: '✏️ Исправить', callback_data: 'calc:reenter' }],
        [{ text: '🏠 Меню', callback_data: 'menu:main' }],
      ]

      if (thinkMsgId) await editMessage(chatId, thinkMsgId, confirmText, keyboard)
      else await sendMessage(chatId, confirmText, keyboard)

      await setSession(tid, 'calc_confirm', {
        parsedInput: parseResult,
        lastDebug: { transcription, parsed: parseResult },
      })
    } catch (err) {
      console.error('[TG] parse error:', err)
      const isTimeout = err instanceof Error && err.message.startsWith('timeout')
      const errText = isTimeout ? '⏱ Распознавание параметров заняло слишком долго.' : '❌ Не удалось распознать параметры. Попробуй снова.'
      if (thinkMsgId) await editMessage(chatId, thinkMsgId, errText, [[{ text: '🔄 Попробовать', callback_data: 'menu:calc' }, { text: '🏠 Меню', callback_data: 'menu:main' }]])
      else await sendMessage(chatId, errText, [[{ text: '🔄 Попробовать', callback_data: 'menu:calc' }, { text: '🏠 Меню', callback_data: 'menu:main' }]])
    }
    return
  }

  if (effectiveState === 'train_input') {
    const waitMsg  = await sendMessage(chatId, '⏳ Сохраняю...') as any
    const waitMsgId = waitMsg?.result?.message_id

    try {
      const classifyResp = await withTimeout(
        anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 200,
          system: 'Classify this AI improvement task. Respond with JSON only: {"title":"short title in Russian","category":"tone|closing|objections|pricing|product|other"}',
          messages: [{ role: 'user', content: inputText }],
        }),
        15000, 'claude-classify'
      )
      let title = inputText.slice(0, 80), category = 'other'
      try {
        const raw = classifyResp.content.find(b => b.type === 'text')?.text ?? '{}'
        const p = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? '{}')
        title = p.title ?? title; category = p.category ?? category
      } catch {}

      await db().from('ai_training_tasks').insert({
        title, description: inputText, source_text: inputText,
        category, priority: 'normal', status: 'pending', created_by: tgUser.user_id,
      })

      const text = `✅ <b>Задача AI сохранена:</b>\n\n${title}\n<i>Категория: ${category}</i>`
      const kb: InlineKeyboard = [[{ text: '➕ Ещё', callback_data: 'menu:train' }, { text: '🏠 Меню', callback_data: 'menu:main' }]]
      if (waitMsgId) await editMessage(chatId, waitMsgId, text, kb)
      else await sendMessage(chatId, text, kb)
      await setSession(tid, 'main_menu')
    } catch (err) {
      console.error('[TG] train error:', err)
      if (waitMsgId) await editMessage(chatId, waitMsgId, '❌ Не удалось сохранить.', [[{ text: '🏠 Меню', callback_data: 'menu:main' }]])
    }
    return
  }

  if (effectiveState === 'lead_send_msg') {
    const ctx = session.context as any
    const chatPhoneId: string = ctx.chatPhoneId
    try {
      const { data: chat } = await db().from('ai_managed_chats').select('channel_id, chat_type').eq('chat_id', chatPhoneId).single()
      if (!chat) throw new Error('chat not found')
      await sendWA(chat.channel_id, chatPhoneId, chat.chat_type, inputText)
      await db().from('ai_conversations').insert({ chat_id: chatPhoneId, role: 'assistant', content: inputText })
      await sendMessage(chatId, `✅ Отправлено!\n\n<i>${inputText}</i>`,
        [[{ text: '◀ К клиенту', callback_data: `lead:${chatPhoneId}` }, { text: '🏠 Меню', callback_data: 'menu:main' }]])
    } catch (err) {
      console.error('[TG] lead_send error:', err)
      await sendMessage(chatId, '❌ Не удалось отправить.', [[{ text: '🏠 Меню', callback_data: 'menu:main' }]])
    }
    await setSession(tid, 'main_menu')
    return
  }

  await sendMessage(chatId, '🏠 <b>Главное меню</b>', MAIN_MENU)
  await setSession(tid, 'main_menu')
}

// ─── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const secret = req.headers.get('x-telegram-bot-api-secret-token')
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!expectedSecret || secret !== expectedSecret) {
    return NextResponse.json({ ok: true })
  }

  let update: any
  try {
    update = await req.json()
  } catch {
    return NextResponse.json({ ok: true })
  }

  after(async () => {
    try {
      await handle(update)
    } catch (err) {
      console.error('[TG] unhandled error:', err)
    }
  })

  return NextResponse.json({ ok: true })
}
