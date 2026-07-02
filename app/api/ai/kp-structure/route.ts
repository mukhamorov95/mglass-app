import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase-server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

// Разбор надиктованного текста в структуру КП. Поддерживает дозапись: если
// передан existing — обновляем его новой репликой, не затирая уже заполненное.
const KP_SCHEMA = {
  type: 'object' as const,
  properties: {
    title:        { type: 'string', description: 'Заголовок — ТОЛЬКО тип изделия(й) ЗАГЛАВНЫМИ, дословно как назвал менеджер. НЕ придумывай названия линеек/коллекций/брендов/моделей и НЕ добавляй эмодзи. Напр. «ДУШЕВАЯ КАБИНА», «ЗЕРКАЛО С ПОДСВЕТКОЙ». Модель добавляй, только если её прямо произнесли.' },
    subtitle:     { type: 'string', description: 'Краткое описание под заголовком: стекло, толщина, фурнитура' },
    client_name:  { type: 'string', description: 'ФИО или название клиента, если назван' },
    client_phone: { type: 'string', description: 'Телефон клиента, если назван' },
    spec: {
      type: 'array',
      description: 'Спецификация изделия — пары «характеристика: значение» (тип изделия, габариты, стекло, толщина, обработка, фурнитура, петля, ручка и т.п.)',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'Название характеристики заглавными, напр. ГАБАРИТЫ' },
          value: { type: 'string', description: 'Значение, напр. 1244 × 1000 мм' },
        },
        required: ['label', 'value'],
      },
    },
    items: {
      type: 'array',
      description: 'Смета — работы и материалы',
      items: {
        type: 'object',
        properties: {
          name:  { type: 'string', description: 'Наименование позиции' },
          desc:  { type: 'string', description: 'Пояснение к позиции' },
          qty:   { type: 'number', description: 'Количество' },
          price: { type: 'number', description: 'Цена за единицу, ₽' },
          sum:   { type: 'number', description: 'Сумма по позиции, ₽' },
        },
        required: ['name'],
      },
    },
    subtotal:        { type: 'number', description: 'Промежуточный итог, ₽' },
    total:           { type: 'number', description: 'Итого к оплате, ₽' },
    production_days: { type: 'string', description: 'Срок изготовления, напр. «15 раб. дней»' },
    warranty:        { type: 'string', description: 'Гарантия, напр. «Изделие + монтаж»' },
    valid_until:     { type: 'string', description: 'Актуально до — дата в формате ДД.ММ.ГГГГ, если названа' },
    spec_note:       { type: 'string', description: 'Примечание к спецификации' },
    notes:           { type: 'string', description: 'Прочие примечания' },
  },
} as const

export async function POST(req: Request) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { transcript, existing } = await req.json() as {
    transcript?: string
    existing?: Record<string, unknown> | null
  }
  if (!transcript || !transcript.trim()) {
    return NextResponse.json({ error: 'empty transcript' }, { status: 400 })
  }

  const sys = [
    'Ты помощник менеджера стекольной компании M-Glass. Разбираешь надиктованную речь',
    'в структуру коммерческого предложения (КП). Извлекай ТОЛЬКО то, что реально сказано.',
    'СТРОГО ЗАПРЕЩЕНО добавлять от себя: названия линеек/коллекций/брендов/моделей',
    '(напр. «AURA», «RADUGA CLASS»), маркетинговые эпитеты, эмодзи, а также цены/суммы,',
    'которых менеджер не называл. Формулировки бери близко к сказанному, не приукрашивай.',
    'Числа приводи к числовому виду (без пробелов и «₽»). Если передан existing — это уже',
    'заполненный КП, обнови его новой репликой: добавляй/исправляй названное, остальное как есть.',
  ].join(' ')

  const userMsg = existing
    ? `Текущий КП (JSON):\n${JSON.stringify(existing)}\n\nНовая реплика менеджера:\n"${transcript}"\n\nВерни обновлённый КП.`
    : `Реплика менеджера:\n"${transcript}"\n\nРазбери в структуру КП.`

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 2000,
      system: sys,
      tools: [{ name: 'kp', description: 'Структура коммерческого предложения', input_schema: KP_SCHEMA }],
      tool_choice: { type: 'tool', name: 'kp' },
      messages: [{ role: 'user', content: userMsg }],
    })
    const tool = msg.content.find(c => c.type === 'tool_use')
    if (!tool || tool.type !== 'tool_use') {
      return NextResponse.json({ error: 'no_structure' }, { status: 502 })
    }
    return NextResponse.json({ kp: tool.input })
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: 'structure_failed', detail: detail.slice(0, 200) }, { status: 502 })
  }
}
