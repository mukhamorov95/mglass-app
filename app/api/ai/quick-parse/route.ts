import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase-server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

// Разбор надиктованной речи в поля «Быстрого расчёта».
const SCHEMA = {
  type: 'object' as const,
  properties: {
    title:       { type: 'string', description: 'Наименование изделия, напр. «Зеркало с подсветкой», «Душевая перегородка»' },
    glass_cost:  { type: 'number', description: 'Себестоимость стекла/зеркала, ₽ (почём обходится M-Glass)' },
    hw_cost:     { type: 'number', description: 'Себестоимость фурнитуры, ₽' },
    per_section: { type: 'number', description: 'Стоимость монтажа за секцию, ₽' },
    sections:    { type: 'number', description: 'Количество секций' },
    delivery:    { type: 'number', description: 'Доставка, ₽' },
    lift:        { type: 'number', description: 'Подъём, ₽' },
    margin:      { type: 'number', description: 'Маржа, % (только если названа)' },
    tax:         { type: 'number', description: 'Налог, % (только если назван)' },
  },
} as const

export async function POST(req: Request) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { transcript } = await req.json() as { transcript?: string }
  if (!transcript || !transcript.trim()) return NextResponse.json({ error: 'empty' }, { status: 400 })

  const sys = 'Ты помощник менеджера стекольной компании M-Glass. Разбираешь надиктованную речь в поля быстрого расчёта. ' +
    'Извлекай ТОЛЬКО то, что реально сказано; числа приводи к числовому виду (без пробелов и «₽»/«%»). ' +
    'Если что-то не названо — не заполняй.'

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 800,
      system: sys,
      tools: [{ name: 'quick', description: 'Поля быстрого расчёта', input_schema: SCHEMA }],
      tool_choice: { type: 'tool', name: 'quick' },
      messages: [{ role: 'user', content: `Реплика менеджера:\n"${transcript}"\n\nРазбери в поля.` }],
    })
    const tool = msg.content.find(c => c.type === 'tool_use')
    if (!tool || tool.type !== 'tool_use') return NextResponse.json({ error: 'no_structure' }, { status: 502 })
    return NextResponse.json({ fields: tool.input })
  } catch (e) {
    const d = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: 'parse_failed', detail: d.slice(0, 200) }, { status: 502 })
  }
}
