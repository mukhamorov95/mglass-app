import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase-server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leads_summary } = await req.json()

  const prompt = `Ты анализируешь B2B воронку компании MGlass (Москва):
— Производство: душевые ограждения, зеркала, лофт-перегородки
— B2B направление: поставка обработанного стекла (резка, полировка, закалка, сверловка)
— Рынок: Москва и МО

Текущая база лидов: ${JSON.stringify(leads_summary)}

Проанализируй и дай структурированный анализ:

1. НЕДООЦЕНЁННЫЕ СЕГМЕНТЫ: какие категории клиентов мало представлены в базе, но имеют высокий потенциал
2. ПРИОРИТЕТ: топ-3 сегмента для активной работы сейчас (по соотношению объём/простота)
3. МАРЖА: где выше маржа и почему
4. REPEAT BUSINESS: где лучше повторяемость заказов
5. МАСШТАБИРОВАНИЕ: какие сегменты легче масштабировать в Москве
6. ПОИСКОВЫЕ ЗАПРОСЫ: для каждого приоритетного сегмента — где и как искать компании (2ГИС, Instagram, Авито, сайты)
7. СЛАБЫЕ МЕСТА: что мешает росту прямо сейчас

Ответь структурированно, конкретно, без воды. На русском языке.`

  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 1500,
    system: 'Ты — B2B стратег с опытом в производственных компаниях. Даёшь практические, применимые рекомендации.',
    messages: [{ role: 'user', content: prompt }],
  })

  const analysis = msg.content[0].type === 'text' ? msg.content[0].text : ''
  return NextResponse.json({ analysis })
}
