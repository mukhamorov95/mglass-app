import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase-server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

// Распознавание старого КП (PDF или текст) для договора: состав позиций и суммы.
// Дальше страница договора сохраняет его в историю КП и подставляет в спецификацию.
const KP_SCHEMA: Anthropic.Tool.InputSchema = {
  type: 'object' as const,
  properties: {
    number:      { type: 'string', description: 'Номер КП/расчёта, если указан (например 0157-2)' },
    client_name: { type: 'string', description: 'Имя клиента / название организации, если указано' },
    date:        { type: 'string', description: 'Дата КП ДД.ММ.ГГГГ, если указана' },
    items: {
      type: 'array',
      description: 'ВСЕ строки КП, включая монтаж, демонтаж, доставку, подъём — отдельными позициями как в документе',
      items: {
        type: 'object',
        properties: {
          name:       { type: 'string', description: 'Наименование позиции (Зеркало, Душевая перегородка, Монтаж, Доставка…)' },
          desc:       { type: 'string', description: 'Описание: стекло, толщина, обработка, фурнитура, цвет — всё что есть в строке' },
          dimensions: { type: 'string', description: 'Размеры, если указаны (например 900×2200 мм)' },
          qty:        { type: 'number', description: 'Количество, шт (1 если не указано)' },
          sum:        { type: 'number', description: 'Сумма строки в ₽ (кол-во × цена)' },
        },
        required: ['name', 'sum'],
      },
    },
    total: { type: 'number', description: 'Итоговая сумма КП в ₽' },
  },
  required: ['items', 'total'],
}

export async function POST(req: Request) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { text, pdf } = await req.json() as { text?: string; pdf?: string }
  if (!text?.trim() && !pdf) return NextResponse.json({ error: 'no input' }, { status: 400 })

  const sys = 'Ты разбираешь коммерческое предложение стекольной компании (зеркала, душевые, лофт-перегородки). ' +
    'Извлеки все позиции с описаниями и суммами ровно как в документе, ничего не выдумывай и не пересчитывай. ' +
    'Монтаж, демонтаж, доставку и подъём оставляй отдельными строками. Суммы — числа в рублях без знаков валюты.'

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content: any[] = []
  if (pdf) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf } })
  content.push({ type: 'text', text: (text?.trim() ? `Текст КП:\n${text}\n\n` : '') + 'Извлеки состав КП в структуру.' })

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 3000,
      system: sys,
      tools: [{ name: 'kp', description: 'Состав коммерческого предложения', input_schema: KP_SCHEMA }],
      tool_choice: { type: 'tool', name: 'kp' },
      messages: [{ role: 'user', content }],
    })
    const tool = msg.content.find(c => c.type === 'tool_use')
    if (!tool || tool.type !== 'tool_use') return NextResponse.json({ error: 'no_structure' }, { status: 502 })
    return NextResponse.json({ kp: tool.input })
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: 'parse_failed', detail: detail.slice(0, 200) }, { status: 502 })
  }
}
