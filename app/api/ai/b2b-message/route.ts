import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase-server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const SEGMENT_CONTEXT: Record<string, string> = {
  designer:     'дизайнер интерьеров — ценит эстетику, качество, может давать много заказов от своих клиентов',
  glass_company:'стекольная компания — может быть партнёром на субподряде или клиентом на материалы',
  furniture:    'мебельная компания — регулярно нужны зеркала и стеклянные элементы для мебели',
  construction: 'строительная компания — крупные объекты, нужен надёжный подрядчик на стекло',
  office:       'офисный сегмент — нужны перегородки, двери, зеркальные элементы',
  renovation:   'ремонтная компания — часто нужны душевые и зеркала для их клиентов',
  aluminum:     'алюминиевые конструкции — возможна совместная работа на объектах',
  studio:       'дизайн-студия — проекты под ключ, дорогие объекты',
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { company_name, segment, contact_name, status, last_activity } = await req.json()

  const segCtx = SEGMENT_CONTEXT[segment] ?? segment
  const hasActivity = last_activity ? `\nПоследний контакт: ${last_activity}` : '\nПервое обращение.'

  const prompt = `Напиши короткое B2B сообщение (WhatsApp) для компании "${company_name}".
Контекст: ${segCtx}.${contact_name ? ` Контакт: ${contact_name}.` : ''}
Статус лида: ${status}.${hasActivity}

Требования:
- 3-5 предложений максимум
- Дружелюбно, без продажного давления
- Конкретная ценность для их сегмента (мы производим зеркала, душевые, лофт-перегородки)
- Чёткий следующий шаг или вопрос
- Без шаблонных фраз "рады предложить" и "обращайтесь"
- Только текст сообщения, без пояснений`

  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    system: 'Ты — B2B менеджер MGlass (производство стеклянных изделий: зеркала, душевые, лофт-перегородки). Пишешь живые, не шаблонные сообщения для потенциальных партнёров. Стиль — деловой но дружелюбный.',
    messages: [{ role: 'user', content: prompt }],
  })

  const message = msg.content[0].type === 'text' ? msg.content[0].text.trim() : ''
  return NextResponse.json({ message })
}
