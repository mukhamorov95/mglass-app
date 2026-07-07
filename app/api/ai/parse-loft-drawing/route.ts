import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase-server'

// Чертёж лофт-перегородки/двери (PDF или фото) → параметры для B2B-калькулятора:
// проём, тип конструкции, количество дверей/глухих частей, стёкол по вертикали.
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const SCHEMA: Anthropic.Tool.InputSchema = {
  type: 'object' as const,
  properties: {
    width_mm:     { type: 'number', description: 'Ширина проёма/изделия, мм (внешний габарит с коробкой)' },
    height_mm:    { type: 'number', description: 'Высота проёма/изделия, мм' },
    construction: { type: 'string', enum: ['fixed', 'swing', 'sliding'], description: 'fixed — стационарная (глухая); swing — распашная (дуги открывания на плане); sliding — раздвижная (трек)' },
    doors:        { type: 'number', description: 'Подвижных створок (распашных дверей или раздвижных). 0 для стационарной' },
    fixed_parts:  { type: 'number', description: 'Глухих (неподвижных) частей рядом с дверями. Для стационарной — число секций' },
    rows:         { type: 'number', description: 'Стёкол по вертикали в створке (горизонтальные перемычки делят створку на N стёкол)' },
    glass_mm:     { type: 'number', description: 'Толщина стекла, мм, если указана' },
    note:         { type: 'string', description: 'Кратко: цвет, тип стекла, особенности (фрамуга, ручки, петли) — по-русски' },
    recognition_quality: { type: 'string', enum: ['full', 'partial'] },
  },
  required: ['width_mm', 'height_mm', 'construction'],
}

export async function POST(req: Request) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { pdf, image, image_type } = await req.json() as { pdf?: string; image?: string; image_type?: string }
  if (!pdf && !image) return NextResponse.json({ error: 'no input' }, { status: 400 })

  const IMG = new Set(['image/jpeg', 'image/png', 'image/webp'])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content: any[] = []
  if (pdf) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf } })
  else if (image) content.push({ type: 'image', source: { type: 'base64', media_type: IMG.has(image_type ?? '') ? image_type : 'image/jpeg', data: image } })
  content.push({ type: 'text', text: 'Это чертёж лофт-перегородки или лофт-двери (стекло в чёрном металлическом профиле). Сними параметры: внешний габарит (ширина × высота, мм), тип (распашная — есть дуги открывания на плане; раздвижная — трек; иначе стационарная), сколько подвижных створок и глухих частей, сколько стёкол по вертикали в створке. Размеры бери только из размерных цепочек.' })

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1000,
      system: 'Ты — инженер стекольного производства. Читаешь чертежи лофт-конструкций точно, ничего не выдумывая: если параметра нет на чертеже — не заполняй поле.',
      tools: [{ name: 'drawing', description: 'Параметры лофта с чертежа', input_schema: SCHEMA }],
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
