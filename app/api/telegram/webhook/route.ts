import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import type { Tool } from '@anthropic-ai/sdk/resources/messages'
import {
  sendMessage, sendMessageWithReplyKeyboard, editMessage, answerCallback, transcribeVoice,
  type InlineKeyboard, type InlineButton,
} from '@/lib/telegram'
import { quickCalc, type CalcType, type CalcOptions } from '@/lib/quickCalc'
import { sendMessage as sendWA } from '@/lib/wazzup'

export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://mglass-app.vercel.app'

function withTimeout<T>(p: Promise<T>, ms: number, label = ''): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout:${label || ms}`)), ms)
    ),
  ])
}

// ─── Menus ───────────────────────────────────────────────────────────────────

const MAIN_MENU: InlineKeyboard = [
  [
    { text: '📊 Дашборд',        callback_data: 'menu:dashboard' },
    { text: '🤖 Агенты',         callback_data: 'menu:agents' },
  ],
  [
    { text: '🧮 Расчёт цены',    callback_data: 'menu:calc' },
    { text: '📋 Лиды',           callback_data: 'menu:leads' },
  ],
  [
    { text: '💬 Написать клиенту', callback_data: 'menu:msg' },
    { text: '📝 Задача в систему', callback_data: 'menu:task' },
  ],
  [
    { text: '🌐 Открыть ERP', url: `${APP_URL}/vlad` },
  ],
]

const TASK_PROMPT = '📝 <b>Задача в систему</b>\n\nНадиктуй голосом или напиши текстом, что нужно сделать. Я разберу, оценю и поставлю в очередь — сразу появится в ERP.\n\n<i>Выход: кнопка «🏠 Меню» или слово «меню»</i>'

// Постоянные кнопки под полем ввода (этап 2 UX, docs/TG_BOT_UX_TZ.md)
const REPLY_KB: string[][] = [
  ['📊 Дашборд', '🧮 Расчёт'],
  ['📝 Задача', '📋 Лиды'],
  ['🏠 Меню', '❓ Помощь'],
]

const HELP_TEXT = [
  '❓ <b>Команды бота</b>',
  '',
  '/menu — главное меню (сбрасывает любой режим)',
  '/dashboard — цифры дня',
  '/calc — расчёт цены (текстом или голосом)',
  '/task — задача в систему (Клод заберёт при запуске)',
  '/agents — AI-агенты: вкл/выкл, запуск',
  '/health — статус интеграций',
  '',
  'В любом режиме слова <b>«меню», «выход», «отмена»</b> возвращают в главное меню.',
  'Режимы сбрасываются сами через 30 минут тишины.',
].join('\n')

const AGENT_ICONS: Record<string, string> = {
  revenue: '💰', analyst: '📊', production: '🏭', catalog: '🧠',
}

// ─── Session ─────────────────────────────────────────────────────────────────

// Режимы (калькулятор/задача/сообщение клиенту) протухают через 30 минут —
// вернувшись в бота позже, пользователь всегда начинает с главного меню.
const SESSION_TTL_MS = 30 * 60 * 1000

async function getSession(tid: number) {
  const { data } = await db().from('telegram_sessions').select('state, context, updated_at').eq('telegram_id', tid).single()
  if (!data) return { state: 'main_menu', context: {} as Record<string, unknown> }
  const age = Date.now() - new Date(data.updated_at ?? 0).getTime()
  if (data.state !== 'main_menu' && age > SESSION_TTL_MS) {
    return { state: 'main_menu', context: {} as Record<string, unknown> }
  }
  return data
}

async function setSession(tid: number, state: string, context: Record<string, unknown> = {}) {
  await db().from('telegram_sessions').upsert({ telegram_id: tid, state, context, updated_at: new Date().toISOString() })
}

async function getTelegramUser(tid: number) {
  const { data } = await db().from('telegram_users').select('user_id').eq('telegram_id', tid).single()
  return data
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

async function handleDashboard(chatId: number, msgId?: number) {
  const supabase = db()
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)

  const [
    { count: calcCount },
    { data: orders },
    { data: b2bOrders },
    { count: inProdCount },
    { data: agentRows },
    { data: followupRows },
  ] = await Promise.all([
    supabase.from('calculations').select('*', { count: 'exact', head: true }).gte('created_at', todayStart.toISOString()),
    supabase.from('orders').select('total_sale_price').gte('created_at', todayStart.toISOString()),
    supabase.from('b2b_orders').select('total_after_discount').gte('created_at', todayStart.toISOString()),
    supabase.from('orders').select('*', { count: 'exact', head: true }).in('status', ['confirmed', 'in_production']),
    supabase.from('agent_settings').select('agent_key, enabled, last_action_text, last_run_at'),
    supabase.from('calculations').select('id', { count: 'exact', head: true }).is('followup_sent_at', null).not('client_phone', 'is', null),
  ])

  const orderRevenue = orders?.reduce((s, o) => s + (o.total_sale_price ?? 0), 0) ?? 0
  const b2bRevenue   = b2bOrders?.reduce((s, o) => s + Number(o.total_after_discount ?? 0), 0) ?? 0
  const totalRevenue = orderRevenue + b2bRevenue
  const activeAgents = agentRows?.filter(a => a.enabled).length ?? 0
  const pendingFollowup = followupRows ?? 0

  const now = new Date()
  const timeStr = now.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' })
  const dateStr = now.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit' })
  const goal500k = 500_000
  const pct = Math.min(100, Math.round(totalRevenue / goal500k * 100))
  const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10))

  const lines = [
    `📊 <b>Дашборд MGlass</b>  <i>${dateStr}, ${timeStr}</i>`,
    ``,
    `<b>Сегодня</b>`,
    `🧮 Расчётов: <b>${calcCount ?? 0}</b>`,
    `💰 Выручка: <b>${totalRevenue.toLocaleString('ru-RU')} ₽</b>`,
    `${bar} ${pct}% от цели 500К`,
    ``,
    `<b>Производство</b>`,
    `🏭 В работе: <b>${inProdCount ?? 0}</b> заказов`,
    ``,
    `<b>AI-команда</b>  ${activeAgents} из ${agentRows?.length ?? 0} активны`,
  ]

  if ((agentRows ?? []).length > 0) {
    for (const a of agentRows ?? []) {
      const icon = AGENT_ICONS[a.agent_key] ?? '🤖'
      const status = a.enabled ? '🟢' : '⚪'
      lines.push(`${status} ${icon} ${a.last_action_text ?? 'ещё не запускался'}`)
    }
  }

  const kb: InlineKeyboard = [
    [
      { text: '🔄 Обновить', callback_data: 'menu:dashboard' },
      { text: '🤖 Агенты',   callback_data: 'menu:agents' },
    ],
    [{ text: '🏠 Меню', callback_data: 'menu:main' }],
  ]

  const text = lines.join('\n')
  if (msgId) await editMessage(chatId, msgId, text, kb)
  else await sendMessage(chatId, text, kb)
}

// ─── Agents menu ─────────────────────────────────────────────────────────────

async function handleAgentsMenu(chatId: number, msgId?: number) {
  const { data: agents } = await db()
    .from('agent_settings')
    .select('agent_key, name, enabled, is_running, last_action_text, last_run_at')
    .order('id')

  const lines = [`🤖 <b>AI-команда MGlass</b>\n`]
  for (const a of agents ?? []) {
    const icon   = AGENT_ICONS[a.agent_key] ?? '🤖'
    const status = a.is_running ? '⚡' : a.enabled ? '🟢' : '⚪'
    lines.push(`${status} ${icon} <b>${a.name}</b>`)
    if (a.last_action_text) lines.push(`   └ <i>${a.last_action_text}</i>`)
  }

  const keyboard: InlineKeyboard = []
  for (const a of agents ?? []) {
    keyboard.push([
      {
        text: `${a.enabled ? '⏸ Выкл' : '▶ Вкл'} ${a.name}`,
        callback_data: `agents:toggle:${a.agent_key}`,
      },
      { text: '🔁 Запустить', callback_data: `agents:run:${a.agent_key}` },
    ])
  }
  keyboard.push([{ text: '🏠 Меню', callback_data: 'menu:main' }])

  const text = lines.join('\n')
  if (msgId) await editMessage(chatId, msgId, text, keyboard)
  else await sendMessage(chatId, text, keyboard)
}

// ─── Calc tools ───────────────────────────────────────────────────────────────

type ParsedCalcInput = {
  type: CalcType; width: number; height: number; options: CalcOptions
}

const PARSE_TOOL: Tool = {
  name: 'extract_params',
  description: 'Извлечь параметры изделия из запроса.',
  input_schema: {
    type: 'object' as const,
    properties: {
      type:          { type: 'string', enum: ['mirror', 'loft', 'shower'] },
      width:         { type: 'number' },
      height:        { type: 'number' },
      shape:         { type: 'string', enum: ['rectangle', 'circle', 'oval'] },
      mirrorType:    { type: 'string', enum: ['silver', 'crystal_vision'] },
      hasLighting:   { type: 'boolean' },
      hasSandblast:  { type: 'boolean' },
      buttonType:    { type: 'string', enum: ['none', 'sensor', 'wave'] },
      withMounting:  { type: 'boolean' },
      model:         { type: 'string' },
      tier:          { type: 'string', enum: ['budget', 'standard'] },
      hardwareColor: { type: 'string' },
      systemType:    { type: 'string', enum: ['fixed', 'sliding', 'swing'] },
      sections:      { type: 'number' },
    },
    required: ['type', 'width', 'height'],
  },
}

const PARSE_SYSTEM = `Ты — строгий парсер параметров MGlass. Задача: извлечь параметры и вызвать extract_params.
ПРАВИЛА:
- Есть тип + размеры → сразу вызывай extract_params
- Нет размеров → спроси: "Укажи размеры (ширина × высота в мм)"
- "круглое/круг" → shape: circle, width=height=диаметр
- "осветлённое/crystal vision" → mirrorType: crystal_vision
- "подсветка/LED" → hasLighting: true
- "монтаж/установка" → withMounting: true
ЗАПРЕЩЕНО добавлять параметры которые пользователь не упоминал.`

function normalizeInput(raw: Record<string, unknown>): ParsedCalcInput {
  const type   = raw.type as CalcType
  let width    = Number(raw.width) || 0
  let height   = Number(raw.height) || 0
  const shape  = raw.shape as CalcOptions['shape'] | undefined
  const colorMap: Record<string, string> = {
    'черн': 'black', 'black': 'black', 'хром': 'chrome', 'chrome': 'chrome',
    'серебр': 'chrome', 'золот': 'gold', 'gold': 'gold', 'брасс': 'brass', 'латунь': 'brass',
  }
  let hardwareColor = raw.hardwareColor as string | undefined
  if (hardwareColor) {
    const lc = hardwareColor.toLowerCase()
    hardwareColor = Object.entries(colorMap).find(([k]) => lc.includes(k))?.[1] ?? hardwareColor
  }
  if (shape === 'circle') { const d = Math.max(width, height); width = height = d }
  const isRound = shape === 'circle' || shape === 'oval'
  const options: CalcOptions = {
    shape,
    hasSubstrate:  isRound || undefined,
    mirrorType:    raw.mirrorType    as CalcOptions['mirrorType']  | undefined,
    hasLighting:   Boolean(raw.hasLighting),
    hasSandblast:  Boolean(raw.hasSandblast),
    buttonType:    (raw.buttonType   as CalcOptions['buttonType']) ?? 'none',
    withMounting:  Boolean(raw.withMounting),
    model:         raw.model         as string | undefined,
    tier:          raw.tier          as CalcOptions['tier']        | undefined,
    hardwareColor,
    systemType:    raw.systemType    as CalcOptions['systemType']  | undefined,
    sections:      raw.sections ? Number(raw.sections) : undefined,
  }
  Object.keys(options).forEach(k => {
    if (options[k as keyof CalcOptions] === undefined) delete options[k as keyof CalcOptions]
  })
  return { type, width, height, options }
}

function formatConfirmText(p: ParsedCalcInput): string {
  const typeLabels: Record<string, string>   = { mirror: '🪞 Зеркало', shower: '🚿 Душевая', loft: '🏗 Лофт' }
  const shapeLabels: Record<string, string>  = { circle: 'круглое', oval: 'овальное', rectangle: 'прямоугольное' }
  const systemLabels: Record<string, string> = { fixed: 'неподвижная', sliding: 'раздвижная', swing: 'распашная' }
  const lines: string[] = ['📋 <b>Я понял запрос так:</b>\n']
  lines.push(`Изделие: <b>${typeLabels[p.type] ?? p.type}</b>`)
  if (p.type === 'mirror') {
    const shape = p.options.shape ?? 'rectangle'
    lines.push(`Форма: <b>${shapeLabels[shape]}</b>`)
    if (shape === 'circle') lines.push(`Диаметр: <b>Ø${p.width} мм</b>`)
    else lines.push(`Размер: <b>${p.width} × ${p.height} мм</b>`)
    lines.push(`Материал: <b>${p.options.mirrorType === 'crystal_vision' ? 'Crystal Vision' : 'Silver'}</b>`)
    if (p.options.hasSubstrate) lines.push('Подложка: ✓')
    if (p.options.hasLighting)  lines.push('Подсветка Aura: ✓')
    if (p.options.hasSandblast) lines.push('Пескоструй: ✓')
    if (p.options.buttonType === 'wave')   lines.push('Кнопка: датчик взмаха')
    if (p.options.buttonType === 'sensor') lines.push('Кнопка: сенсорная')
  } else if (p.type === 'shower') {
    lines.push(`Размер: <b>${p.width} × ${p.height} мм</b>`)
    if (p.options.model)         lines.push(`Модель: <b>${p.options.model}</b>`)
    if (p.options.tier)          lines.push(`Класс: <b>${p.options.tier === 'budget' ? 'Бюджет' : 'Стандарт'}</b>`)
    if (p.options.hardwareColor) lines.push(`Фурнитура: <b>${p.options.hardwareColor}</b>`)
    if (p.options.systemType)    lines.push(`Тип: <b>${systemLabels[p.options.systemType!]}</b>`)
  } else if (p.type === 'loft') {
    lines.push(`Размер: <b>${p.width} × ${p.height} мм</b>`)
    if (p.options.sections)   lines.push(`Секций: <b>${p.options.sections}</b>`)
    if (p.options.systemType) lines.push(`Тип: <b>${systemLabels[p.options.systemType!]}</b>`)
  }
  if (p.options.withMounting) lines.push('Монтаж: включён ✓')
  lines.push('\nВсё верно?')
  return lines.join('\n')
}

async function runCalc(p: ParsedCalcInput): Promise<{ reply: string; hasResult: boolean; margin: number }> {
  const result = await withTimeout(quickCalc(p.type, p.width, p.height, p.options), 12000, 'quickCalc')
  if (!result) return { reply: '❌ Не удалось рассчитать. Проверь параметры.', hasResult: false, margin: 0 }
  const icon  = result.margin >= 40 ? '🟢' : result.margin >= 30 ? '🟡' : '🔴'
  const fmt   = (n: number) => n.toLocaleString('ru-RU') + ' ₽'
  const reply = [result.description, '', `📊 <i>Маржа: ${result.margin}% ${icon} | Итого: ${fmt(result.price)}</i>`].join('\n')
  return { reply, hasResult: true, margin: result.margin }
}

async function parseCalcInput(text: string): Promise<ParsedCalcInput | string> {
  const response = await withTimeout(
    anthropic.messages.create({
      model: 'claude-sonnet-5', max_tokens: 300,
      system: PARSE_SYSTEM, tools: [PARSE_TOOL], tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: text }],
    }),
    20000, 'claude-parse'
  )
  if (response.stop_reason !== 'tool_use') {
    return response.content.find(b => b.type === 'text')?.text ?? 'Укажи тип изделия и размеры.'
  }
  const block = response.content.find(b => b.type === 'tool_use')
  if (!block || block.type !== 'tool_use') return 'Укажи тип изделия и размеры.'
  return normalizeInput(block.input as Record<string, unknown>)
}

// ─── Leads keyboard ───────────────────────────────────────────────────────────

function leadsKeyboard(chats: { is_active?: boolean; client_name?: string | null; chat_id: string }[], page: number): InlineKeyboard {
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

// ─── /health & /debug ─────────────────────────────────────────────────────────

async function handleHealth(chatId: number) {
  const checks: string[] = ['🔧 <b>Статус MGlass Bot</b>\n']
  try {
    await withTimeout(Promise.resolve(db().from('telegram_sessions').select('telegram_id').limit(1)), 4000, 'supabase')
    checks.push('✅ Supabase — подключён')
  } catch { checks.push('❌ Supabase — ошибка') }
  checks.push(process.env.ANTHROPIC_API_KEY ? '✅ Anthropic — ключ задан' : '❌ Anthropic — ключ не задан')
  checks.push(process.env.OPENAI_API_KEY    ? '✅ OpenAI (голос) — ключ задан' : '⚠️ OpenAI — ключ не задан')
  checks.push(process.env.TELEGRAM_BOT_TOKEN ? '✅ Telegram token — задан' : '❌ Telegram token — не задан')
  checks.push(process.env.WAZZUP_API_KEY ? '✅ Wazzup — ключ задан' : '⚠️ Wazzup — ключ не задан')
  checks.push('✅ Webhook — активен')
  await sendMessage(chatId, checks.join('\n'), [[{ text: '🏠 Меню', callback_data: 'menu:main' }]])
}

// ─── Main handler ─────────────────────────────────────────────────────────────

// Telegram update — произвольная структура API, глубокая типизация здесь не оправдана
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handle(update: any, baseUrl: string) {
  const msg = update.message
  const cb  = update.callback_query
  if (!msg && !cb) return

  const tid    = (msg ?? cb.message).chat.id as number
  const chatId = tid

  if (msg?.text) {
    const cmd = msg.text.trim().split(/[\s@]/)[0].toLowerCase()
    if (cmd === '/health') { await handleHealth(chatId); return }
  }

  const tgUser = await getTelegramUser(tid)

  // ── Неавторизованный ──
  if (!tgUser) {
    if (msg?.text && /^\d{6}$/.test(msg.text.trim())) {
      const code     = msg.text.trim()
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
      await sendMessage(chatId, `✅ Привязка успешна! Добро пожаловать.`, MAIN_MENU)
      return
    }
    await sendMessage(chatId, '🔒 Введи <b>6-значный код</b> из MGlass (Admin → Пользователи → кнопка TG).')
    return
  }

  const session = await getSession(tid)

  // ── Команды ──
  if (msg?.text) {
    const cmd = msg.text.trim().split(/[\s@]/)[0].toLowerCase()
    const plain = msg.text.trim().toLowerCase()
    if (cmd === '/start' || cmd === '/menu' || ['меню', 'выход', 'отмена', 'стоп', 'stop', '🏠 меню'].includes(plain)) {
      await sendMessageWithReplyKeyboard(chatId, '🏠 <b>Главное меню</b>\nКнопки — снизу, под полем ввода.', REPLY_KB)
      await sendMessage(chatId, 'Быстрые действия:', MAIN_MENU)
      await setSession(tid, 'main_menu')
      return
    }
    if (cmd === '/help' || plain === '❓ помощь' || plain === 'помощь') {
      await sendMessage(chatId, HELP_TEXT, [[{ text: '🏠 Меню', callback_data: 'menu:main' }]])
      return
    }
    // Кнопки постоянной клавиатуры — синонимы команд
    if (plain === '📊 дашборд') { await handleDashboard(chatId); return }
    if (plain === '🧮 расчёт') {
      await sendMessage(chatId, '🧮 <b>Расчёт цены</b>\n\nОпиши изделие и размеры текстом или голосом.\n<i>Пример: Зеркало 800×600. Выход: слово «меню»</i>')
      await setSession(tid, 'calc_input')
      return
    }
    if (plain === '📝 задача') {
      await sendMessage(chatId, TASK_PROMPT, [[{ text: '🏠 Меню', callback_data: 'menu:main' }]])
      await setSession(tid, 'task_input')
      return
    }
    if (plain === '📋 лиды') {
      await sendMessage(chatId, '📋 Лиды:', [[{ text: '📋 Открыть список', callback_data: 'menu:leads' }]])
      return
    }
    if (cmd === '/d' || cmd === '/dashboard') {
      await handleDashboard(chatId)
      return
    }
    if (cmd === '/agents') {
      await handleAgentsMenu(chatId)
      return
    }
    if (cmd === '/calc') {
      await sendMessage(chatId, '🧮 <b>Расчёт цены</b>\n\nОпиши изделие и размеры текстом или голосом.\n<i>Пример: Зеркало 800×600, Душевая 1000×2000 с монтажом</i>')
      await setSession(tid, 'calc_input')
      return
    }
    if (cmd === '/task' || cmd === '/задача') {
      await sendMessage(chatId, TASK_PROMPT, [[{ text: '🏠 Меню', callback_data: 'menu:main' }]])
      await setSession(tid, 'task_input')
      return
    }
  }

  // ── Callbacks ──
  if (cb) {
    await answerCallback(cb.id)
    const data: string  = cb.data
    const msgId: number = cb.message.message_id

    // Главное меню
    if (data === 'menu:main') {
      await editMessage(chatId, msgId, '🏠 <b>Главное меню</b>', MAIN_MENU)
      await setSession(tid, 'main_menu')
      return
    }

    // Дашборд
    if (data === 'menu:dashboard') {
      await handleDashboard(chatId, msgId)
      return
    }

    // Задача в систему (очередь Клода)
    if (data === 'menu:task') {
      await editMessage(chatId, msgId, TASK_PROMPT, [[{ text: '🏠 Меню', callback_data: 'menu:main' }]])
      await setSession(tid, 'task_input')
      return
    }

    // Агенты — список
    if (data === 'menu:agents') {
      await handleAgentsMenu(chatId, msgId)
      return
    }

    // Агенты — вкл/выкл
    if (data.startsWith('agents:toggle:')) {
      const key = data.slice(14)
      const { data: current } = await db().from('agent_settings').select('enabled, name').eq('agent_key', key).single()
      if (current) {
        await db().from('agent_settings')
          .update({ enabled: !current.enabled, updated_at: new Date().toISOString() })
          .eq('agent_key', key)
        await answerCallback(cb.id, current.enabled ? `⏸ ${current.name} остановлен` : `▶ ${current.name} запущен`)
      }
      await handleAgentsMenu(chatId, msgId)
      return
    }

    // Агенты — запустить
    if (data.startsWith('agents:run:')) {
      const key = data.slice(11)
      const { data: agent } = await db().from('agent_settings').select('name, enabled').eq('agent_key', key).single()
      if (!agent?.enabled) {
        await answerCallback(cb.id, '⚠️ Сначала включи агента')
        return
      }
      await answerCallback(cb.id, '⏳ Запускаю...')
      // Запускаем асинхронно — результат придёт через уведомление
      fetch(`${baseUrl}/api/cron/agent-${key}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? ''}`, 'Content-Type': 'application/json' },
      }).then(() => {}).catch(() => {})
      await sendMessage(chatId, `⏳ <b>${agent.name}</b> запускается...\nРезультат придёт сюда.`,
        [[{ text: '🤖 К агентам', callback_data: 'menu:agents' }]])
      return
    }

    // Наполнитель — одобрить позицию
    if (data.startsWith('catalog:approve:')) {
      const approvalId = data.slice(16)
      const supabase = db()
      const { data: settings } = await supabase
        .from('agent_settings').select('memory').eq('agent_key', 'catalog').single()
      const memory = settings?.memory as Record<string, unknown>
      const pending = (memory?.pending_approvals ?? []) as Array<{
        id: string; table: string; name: string; category?: string; reason: string
      }>
      const item = pending.find(p => p.id === approvalId)
      if (!item) {
        await answerCallback(cb.id, '⚠️ Позиция уже обработана')
        return
      }
      try {
        const row: Record<string, string> = { name: item.name }
        if (item.category) row.category = item.category
        await supabase.from(item.table).insert(row)
        const newPending = pending.filter(p => p.id !== approvalId)
        await supabase.from('agent_settings').update({
          memory: { ...memory, pending_approvals: newPending, approved_count: ((memory.approved_count as number) ?? 0) + 1 },
        }).eq('agent_key', 'catalog')
        await answerCallback(cb.id, `✅ Добавлено: ${item.name}`)
        await editMessage(chatId, msgId,
          `✅ <b>Добавлено в ${item.table}:</b> ${item.name}${item.category ? ` (${item.category})` : ''}`,
          [[{ text: '🤖 Агенты', callback_data: 'menu:agents' }]])
      } catch {
        await answerCallback(cb.id, '❌ Ошибка при добавлении')
      }
      return
    }

    // Наполнитель — отклонить позицию
    if (data.startsWith('catalog:reject:')) {
      const approvalId = data.slice(15)
      const supabase = db()
      const { data: settings } = await supabase
        .from('agent_settings').select('memory').eq('agent_key', 'catalog').single()
      const memory = settings?.memory as Record<string, unknown>
      const pending = (memory?.pending_approvals ?? []) as Array<{ id: string }>
      const newPending = pending.filter(p => p.id !== approvalId)
      await supabase.from('agent_settings').update({
        memory: { ...memory, pending_approvals: newPending },
      }).eq('agent_key', 'catalog')
      await answerCallback(cb.id, '❌ Отклонено')
      await editMessage(chatId, msgId, '❌ <i>Предложение отклонено</i>',
        [[{ text: '🤖 Агенты', callback_data: 'menu:agents' }]])
      return
    }

    // Расчёт
    if (data === 'menu:calc') {
      await editMessage(chatId, msgId,
        '🧮 <b>Расчёт цены</b>\n\nОпиши изделие и размеры текстом или голосом.\n<i>Пример: Душевая 1000×2000 распашная с монтажом</i>')
      await setSession(tid, 'calc_input')
      return
    }

    if (data === 'calc:confirm') {
      const ctx    = session.context as { parsedInput?: ParsedCalcInput } | null
      const parsed = ctx?.parsedInput
      if (!parsed) {
        await editMessage(chatId, msgId, '❌ Параметры устарели. Введи запрос заново.',
          [[{ text: '🧮 Расчёт', callback_data: 'menu:calc' }]])
        return
      }
      const waitMsg   = await sendMessage(chatId, '⏳ Считаю...') as { result?: { message_id?: number } }
      const waitMsgId = waitMsg?.result?.message_id
      try {
        const { reply, hasResult, margin } = await runCalc(parsed)
        const keyboard: InlineKeyboard = hasResult
          ? [[{ text: '💾 Сохранить', callback_data: 'calc:save' }], [{ text: '🔄 Ещё', callback_data: 'menu:calc' }, { text: '🏠 Меню', callback_data: 'menu:main' }]]
          : [[{ text: '🏠 Меню', callback_data: 'menu:main' }]]
        if (waitMsgId) await editMessage(chatId, waitMsgId, reply, keyboard)
        else await sendMessage(chatId, reply, keyboard)
        await setSession(tid, hasResult ? 'main_menu' : 'calc_input', { ...ctx, calcText: reply })
      } catch (err) {
        const isTimeout = err instanceof Error && err.message.startsWith('timeout')
        const errText   = isTimeout ? '⏱ Расчёт занял слишком долго.' : '❌ Ошибка расчёта. Попробуй снова.'
        const kb: InlineKeyboard = [[{ text: '🔄 Попробовать', callback_data: 'menu:calc' }, { text: '🏠 Меню', callback_data: 'menu:main' }]]
        if (waitMsgId) await editMessage(chatId, waitMsgId, errText, kb)
        else await sendMessage(chatId, errText, kb)
      }
      return
    }

    if (data === 'calc:reenter') {
      await editMessage(chatId, msgId,
        '🧮 <b>Расчёт цены</b>\n\nОпиши изделие заново.\n<i>Пример: Круглое зеркало 800 мм</i>')
      await setSession(tid, 'calc_input')
      return
    }

    if (data === 'calc:save') {
      const ctx = session.context as { calcText?: string } | null
      if (ctx?.calcText) {
        await db().from('ai_training_tasks').insert({
          title: 'Расчёт из Telegram', description: ctx.calcText,
          source_text: ctx.calcText, category: 'calculation', created_by: tgUser.user_id,
        })
      }
      await answerCallback(cb.id, '✅ Сохранено')
      await editMessage(chatId, msgId, '✅ Расчёт сохранён.',
        [[{ text: '🏠 Меню', callback_data: 'menu:main' }]])
      return
    }

    // Лиды
    if (data === 'menu:leads' || data.startsWith('leads:page:')) {
      const page = data.startsWith('leads:page:') ? parseInt(data.split(':')[2]) : 0
      const { data: chats } = await db()
        .from('ai_managed_chats').select('chat_id, client_name, is_active, last_message_at')
        .order('last_message_at', { ascending: false, nullsFirst: false }).limit(50)
      const list = chats ?? []
      if (!list.length) {
        await editMessage(chatId, msgId, '📋 Нет активных лидов.',
          [[{ text: '🏠 Меню', callback_data: 'menu:main' }]])
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
      await editMessage(chatId, msgId, '📋 <b>Выбери клиента:</b>', leadsKeyboard(chats ?? [], 0))
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
            ? { text: '⏸ Стоп AI', callback_data: `lead:pause:${chatPhoneId}` }
            : { text: '▶ Вкл AI',  callback_data: `lead:resume:${chatPhoneId}` },
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
      await handle({ callback_query: { ...cb, data: `lead:${chatPhoneId}` } }, baseUrl)
      return
    }

    if (data.startsWith('lead:resume:')) {
      const chatPhoneId = data.slice(12)
      await db().from('ai_managed_chats').update({ is_active: true, close_reason: null }).eq('chat_id', chatPhoneId)
      await answerCallback(cb.id, '▶ AI включён')
      await handle({ callback_query: { ...cb, data: `lead:${chatPhoneId}` } }, baseUrl)
      return
    }

    if (data.startsWith('lead:msg:')) {
      const chatPhoneId = data.slice(9)
      await editMessage(chatId, msgId, `💬 Введи сообщение для <b>${chatPhoneId}</b>. Текстом или голосом.`)
      await setSession(tid, 'lead_send_msg', { chatPhoneId })
      return
    }

    return
  }

  // ── Text / Voice ──
  let inputText    = msg?.text ?? ''
  let transcription: string | undefined

  if (msg?.voice || msg?.audio) {
    if (!process.env.OPENAI_API_KEY) {
      await sendMessage(chatId, '⚠️ Голосовое распознавание не настроено. Отправь текстом.',
        [[{ text: '🏠 Меню', callback_data: 'menu:main' }]])
      return
    }
    const fileId   = msg.voice?.file_id ?? msg.audio?.file_id
    const statusMsg   = await sendMessage(chatId, '🎙 Распознаю голос...') as { result?: { message_id?: number } }
    const statusMsgId = statusMsg?.result?.message_id
    try {
      inputText    = await withTimeout(transcribeVoice(fileId), 40_000, 'voice_pipeline')
      transcription = inputText
      if (!inputText) {
        const reply = '🎙 Не смог разобрать. Говори чётче или напиши текстом.'
        if (statusMsgId) await editMessage(chatId, statusMsgId, reply, [[{ text: '🏠 Меню', callback_data: 'menu:main' }]])
        else await sendMessage(chatId, reply)
        return
      }
      if (statusMsgId) await editMessage(chatId, statusMsgId, `🎙 Распознал: <i>${inputText}</i>`)
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err)
      const reply = m.startsWith('timeout') ? '⏱ Распознавание заняло слишком долго.' : '❌ Не удалось распознать голос.'
      if (statusMsgId) await editMessage(chatId, statusMsgId, reply, [[{ text: '🏠 Меню', callback_data: 'menu:main' }]])
      else await sendMessage(chatId, reply)
      return
    }
  }

  if (!inputText) return

  // Голос уважает активный режим (задача/обучение/сообщение клиенту); иначе — калькулятор
  const VOICE_AWARE_STATES = ['task_input', 'train_input', 'lead_send_msg']
  const effectiveState = transcription
    ? (VOICE_AWARE_STATES.includes(session.state) ? session.state : 'calc_input')
    : session.state

  if (effectiveState === 'main_menu' || effectiveState === 'leads_list') {
    await sendMessage(chatId, '🏠 <b>Главное меню</b>', MAIN_MENU)
    await setSession(tid, 'main_menu')
    return
  }

  if (effectiveState === 'calc_input') {
    const thinkMsg   = await sendMessage(chatId, '🔍 Распознаю параметры...') as { result?: { message_id?: number } }
    const thinkMsgId = thinkMsg?.result?.message_id
    try {
      const parseResult = await parseCalcInput(inputText)
      if (typeof parseResult === 'string') {
        if (thinkMsgId) await editMessage(chatId, thinkMsgId, parseResult, [[{ text: '🏠 Меню', callback_data: 'menu:main' }]])
        else await sendMessage(chatId, parseResult, [[{ text: '🏠 Меню', callback_data: 'menu:main' }]])
        return
      }
      const confirmText = formatConfirmText(parseResult)
      const keyboard: InlineKeyboard = [
        [{ text: '✅ Считать', callback_data: 'calc:confirm' }, { text: '✏️ Исправить', callback_data: 'calc:reenter' }],
        [{ text: '🏠 Меню', callback_data: 'menu:main' }],
      ]
      if (thinkMsgId) await editMessage(chatId, thinkMsgId, confirmText, keyboard)
      else await sendMessage(chatId, confirmText, keyboard)
      await setSession(tid, 'calc_confirm', {
        parsedInput: parseResult,
        lastDebug:   { transcription, parsed: parseResult },
      })
    } catch (err) {
      const isTimeout = err instanceof Error && err.message.startsWith('timeout')
      const errText   = isTimeout ? '⏱ Слишком долго.' : '❌ Не удалось распознать параметры.'
      if (thinkMsgId) await editMessage(chatId, thinkMsgId, errText,
        [[{ text: '🔄 Попробовать', callback_data: 'menu:calc' }, { text: '🏠 Меню', callback_data: 'menu:main' }]])
      else await sendMessage(chatId, errText)
    }
    return
  }

  if (effectiveState === 'task_input') {
    const waitMsg   = await sendMessage(chatId, '🧠 Разбираю задачу...') as { result?: { message_id?: number } }
    const waitMsgId = waitMsg?.result?.message_id
    try {
      let title = inputText.slice(0, 100), category = 'other', priority = 'normal'
      let structured = inputText, assessment = ''
      try {
        const resp = await withTimeout(
          anthropic.messages.create({
            model: 'claude-sonnet-5', max_tokens: 600,
            system: 'Ты — техлид ERP стекольной компании M-Glass (Next.js + Supabase: продажи B2C/B2B, производство, CFO, маркетинг). Владелец диктует задачу. Верни ТОЛЬКО JSON: {"title":"короткий заголовок по-русски","structured":"чёткая формулировка задачи 1-3 предложения: что сделать и где","category":"production|sales|finance|marketing|it|other","priority":"low|normal|high","assessment":"оценка в 1-2 предложениях: насколько понятна задача, что уточнить, примерный размер (S/M/L)"}',
            messages: [{ role: 'user', content: inputText }],
          }), 25000, 'claude-task'
        )
        const raw = resp.content.find(b => b.type === 'text')?.text ?? '{}'
        const p = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? '{}')
        title = p.title ?? title; category = p.category ?? category
        priority = p.priority ?? priority; structured = p.structured ?? structured
        assessment = p.assessment ?? ''
      } catch { /* сохраняем сырую формулировку — очередь важнее разбора */ }
      const { data: row } = await db().from('owner_tasks').insert({
        raw_text: inputText, title, details: structured, category, priority,
        source: transcription ? 'voice' : 'text', status: 'queued', created_by: tgUser.user_id,
      }).select('id').single()
      const { count } = await db().from('owner_tasks').select('id', { count: 'exact', head: true }).eq('status', 'queued')
      const { data: liveWorkers } = await db().from('owner_task_workers')
        .select('worker_id').gte('last_seen', new Date(Date.now() - 5 * 60_000).toISOString()).limit(1)
      const workerAlive = (liveWorkers?.length ?? 0) > 0
      const text = [
        `✅ <b>Задача #${row?.id ?? '?'} в очереди</b> (в очереди: ${count ?? 1})`,
        '',
        `<b>${title}</b>`,
        structured !== title ? structured : '',
        `<i>Категория: ${category} · приоритет: ${priority}</i>`,
        assessment ? `\n🧠 ${assessment}` : '',
        '',
        workerAlive
          ? '<i>🟢 Воркер активен — задача уйдёт в работу.</i>'
          : '<i>⚪️ Воркер не запущен — подхватит при следующем старте. Можно открыть в ERP.</i>',
      ].filter(Boolean).join('\n')
      const kb: InlineKeyboard = [
        [{ text: '📋 Открыть задачи в ERP', url: `${APP_URL}/vlad/tasks` }],
        [{ text: '➕ Ещё задачу', callback_data: 'menu:task' }, { text: '🏠 Меню', callback_data: 'menu:main' }],
      ]
      if (waitMsgId) await editMessage(chatId, waitMsgId, text, kb)
      else await sendMessage(chatId, text, kb)
      await setSession(tid, 'task_input') // остаёмся в режиме — можно диктовать подряд
    } catch {
      if (waitMsgId) await editMessage(chatId, waitMsgId, '❌ Не удалось сохранить задачу.',
        [[{ text: '🔄 Ещё раз', callback_data: 'menu:task' }, { text: '🏠 Меню', callback_data: 'menu:main' }]])
    }
    return
  }

  if (effectiveState === 'train_input') {
    const waitMsg   = await sendMessage(chatId, '⏳ Сохраняю...') as { result?: { message_id?: number } }
    const waitMsgId = waitMsg?.result?.message_id
    try {
      const resp = await withTimeout(
        anthropic.messages.create({
          model: 'claude-sonnet-5', max_tokens: 200,
          system: 'Classify this AI improvement task. Respond with JSON only: {"title":"short title in Russian","category":"tone|closing|objections|pricing|product|other"}',
          messages: [{ role: 'user', content: inputText }],
        }), 15000, 'claude-classify'
      )
      let title = inputText.slice(0, 80), category = 'other'
      try {
        const raw = resp.content.find(b => b.type === 'text')?.text ?? '{}'
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
    } catch {
      if (waitMsgId) await editMessage(chatId, waitMsgId, '❌ Не удалось сохранить.',
        [[{ text: '🏠 Меню', callback_data: 'menu:main' }]])
    }
    return
  }

  if (effectiveState === 'lead_send_msg') {
    const ctx = session.context as { chatPhoneId: string }
    const chatPhoneId: string = ctx.chatPhoneId
    try {
      const { data: chat } = await db().from('ai_managed_chats').select('channel_id, chat_type').eq('chat_id', chatPhoneId).single()
      if (!chat) throw new Error('chat not found')
      await sendWA(chat.channel_id, chatPhoneId, chat.chat_type, inputText)
      await db().from('ai_conversations').insert({ chat_id: chatPhoneId, role: 'assistant', content: inputText })
      await sendMessage(chatId, `✅ Отправлено!\n\n<i>${inputText}</i>`,
        [[{ text: '◀ К клиенту', callback_data: `lead:${chatPhoneId}` }, { text: '🏠 Меню', callback_data: 'menu:main' }]])
    } catch {
      await sendMessage(chatId, '❌ Не удалось отправить.',
        [[{ text: '🏠 Меню', callback_data: 'menu:main' }]])
    }
    await setSession(tid, 'main_menu')
    return
  }

  await sendMessage(chatId, '🏠 <b>Главное меню</b>', MAIN_MENU)
  await setSession(tid, 'main_menu')
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const secret         = req.headers.get('x-telegram-bot-api-secret-token')
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!expectedSecret || secret !== expectedSecret) {
    return NextResponse.json({ ok: true })
  }

  let update: unknown
  try { update = await req.json() } catch { return NextResponse.json({ ok: true }) }

  const host    = req.headers.get('host') ?? 'localhost:3000'
  const isLocal = host.includes('localhost') || host.includes('127.0.0.1')
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? `${isLocal ? 'http' : 'https'}://${host}`

  after(async () => {
    try { await handle(update, baseUrl) }
    catch (err) { console.error('[TG] unhandled error:', err) }
  })

  return NextResponse.json({ ok: true })
}
