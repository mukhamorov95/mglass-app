import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase-server'

// Разбор чертежа (PDF/фото) в параметры ОДНОЙ позиции B2B-калькулятора под
// текущий тип: стекло/зеркало, зеркало+свет, лофт. (Многодетальный разбор — в parse-drawing.)
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const SCHEMA: Anthropic.Tool.InputSchema = {
  type: 'object' as const,
  properties: {
    width_mm:     { type: 'number', description: 'Ширина изделия/проёма, мм (внешний габарит)' },
    height_mm:    { type: 'number', description: 'Высота изделия/проёма, мм' },
    quantity:     { type: 'number', description: 'Количество, шт (1 если не указано)' },
    thickness_mm: { type: 'number', description: 'Толщина стекла/зеркала, мм, если указана (4, 6, 8, 10…)' },
    glass_kind:   { type: 'string', description: 'Тип стекла/зеркала кратко: прозрачное/осветлённое, тонированное (бронза/графит), матовое, зеркало' },
    tempering:    { type: 'boolean', description: 'true если стекло закалённое (закалка/tempered)' },
    holes:        { type: 'boolean', description: 'true если есть отверстия/сверловка (петли, крепёж)' },
    // только для лофта
    construction: { type: 'string', enum: ['fixed', 'swing', 'sliding'], description: 'Лофт: fixed — стационарная; swing — распашная (дуги открывания); sliding — раздвижная (трек)' },
    doors:        { type: 'number', description: 'Лофт: подвижных створок (распашных/раздвижных). 0 для стационарной' },
    fixed_parts:  { type: 'number', description: 'Лофт: глухих частей рядом с дверями (для стационарной — число секций)' },
    rows:         { type: 'number', description: 'Лофт: стёкол по вертикали в створке' },
    note:         { type: 'string', description: 'Кратко по-русски: цвет, тип стекла, особенности, фурнитура' },
  },
  required: ['width_mm', 'height_mm'],
}

const KIND_HINT: Record<string, string> = {
  material: 'Это чертёж изделия из стекла или зеркала. Сними габарит (ширина × высота), толщину, тип стекла/зеркала, есть ли закалка и отверстия.',
  fmirror:  'Это чертёж зеркала (возможно с подсветкой). Сними габарит (ширина × высота) и особенности.',
  floft:    'Это чертёж лофт-перегородки/двери (стекло в чёрном металлопрофиле). Сними внешний габарит, тип (распашная — дуги открывания; раздвижная — трек; иначе стационарная), число подвижных створок и глухих частей, стёкол по вертикали.',
}

export async function POST(req: Request) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { pdf, image, image_type, kind } = await req.json() as { pdf?: string; image?: string; image_type?: string; kind?: string }
  if (!pdf && !image) return NextResponse.json({ error: 'no input' }, { status: 400 })

  const IMG = new Set(['image/jpeg', 'image/png', 'image/webp'])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content: any[] = []
  if (pdf) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf } })
  else if (image) content.push({ type: 'image', source: { type: 'base64', media_type: IMG.has(image_type ?? '') ? image_type : 'image/jpeg', data: image } })
  content.push({ type: 'text', text: (KIND_HINT[kind ?? ''] ?? KIND_HINT.material) + ' Размеры бери ТОЛЬКО из размерных цепочек чертежа, ничего не выдумывай.' })

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1000,
      system: 'Ты — инженер стекольного производства. Читаешь чертежи точно: если параметра нет на чертеже — не заполняй поле.',
      tools: [{ name: 'drawing', description: 'Параметры изделия с чертежа', input_schema: SCHEMA }],
      tool_choice: { type: 'tool', name: 'drawing' },
      messages: [{ role: 'user', content }],
    })
    const tool = msg.content.find(c => c.type === 'tool_use')
    if (!tool || tool.type !== 'tool_use') return NextResponse.json({ error: 'no_structure' }, { status: 502 })
    return NextResponse.json({ drawing: tool.input })
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: 'parse_failed', detail: detail.slice(0, 200) }, { status: 502 })
  }
}
