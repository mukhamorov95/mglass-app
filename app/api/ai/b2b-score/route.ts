import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase-server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { lead } = await req.json()

  const prompt = `Оцени B2B лид для компании MGlass (производство душевых ограждений, зеркал, лофт-перегородок, обработка стекла в Москве).

Лид:
Компания: ${lead.company_name}
Сегмент: ${lead.segment}
Размер: ${lead.size_category ?? 'неизвестно'}
Потенциал ₽/мес: ${lead.potential_monthly ?? 'не указан'}
Заметки: ${lead.notes ?? 'нет'}
Текущий статус: ${lead.status}

Оцени по системе:
A — Высокий потенциал: регулярные заказы, объём, долгосрочное партнёрство, хорошо подходит MGlass
B — Средний потенциал: есть интерес, но нерегулярно или небольшой объём
C — Низкий потенциал: разовый заказ, мало подходит, трудно конвертировать

Ответь ТОЛЬКО в формате JSON:
{
  "score": "A" | "B" | "C",
  "reason": "краткое объяснение (1-2 предложения)",
  "recommendation": "что делать с этим лидом (1 предложение)"
}`

  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 256,
    system: 'Ты — B2B аналитик производственной компании MGlass. Отвечаешь только валидным JSON.',
    messages: [{ role: 'user', content: prompt }],
  })

  try {
    const text = msg.content[0].type === 'text' ? msg.content[0].text : '{}'
    const result = JSON.parse(text.replace(/```json\s*/gi, '').replace(/```/g, '').trim())

    // Save score to lead
    await supabase.from('b2b_leads').update({
      score: result.score,
      ai_summary: result.reason,
    }).eq('id', lead.id)

    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ score: 'C', reason: 'Не удалось оценить', recommendation: 'Добавьте больше данных' })
  }
}
