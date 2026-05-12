import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase-server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { segment, description, count = 10 } = await req.json()

  const SEGMENT_CONTEXT: Record<string, string> = {
    designer:     'дизайн-студии интерьера и частные дизайнеры, которые делают ванные комнаты, кухни, квартиры',
    furniture:    'мебельные фабрики, студии кухонь, производители шкафов-купе — кому нужны зеркала и стекло для фасадов',
    construction: 'строительные компании, ремонтные бригады, застройщики — кому нужны душевые, зеркала, перегородки под объекты',
    aluminum:     'компании, производящие алюминиевые конструкции и офисные перегородки — кому нужно закалённое стекло под нарезку',
    glass_company:'стекольные мастерские и монтажники без собственной закалки — субподряд на закалку, резку, полировку',
    office:       'управляющие компании, fit-out подрядчики — кому нужны офисные лофт-перегородки из стекла',
    renovation:   'ремонтные компании, работающие в жилом сегменте Москвы и МО',
    studio:       'архитектурные бюро и проектные студии',
  }

  const segCtx = SEGMENT_CONTEXT[segment] ?? segment

  const prompt = `Ты помогаешь B2B-менеджеру компании MGlass (производство стекла, Москва) составить список компаний для холодного outreach.

Сегмент: ${segCtx}
Дополнительный контекст от менеджера: ${description || 'не указан'}
Город: Москва и МО

Сгенерируй ${count} реалистичных компаний для проспектинга. Это должны быть правдоподобные профили компаний, которые МОГУТ существовать в Москве в этом сегменте. НЕ выдумывай известные бренды — создавай реалистичные небольшие/средние московские компании.

Ответь ТОЛЬКО валидным JSON-массивом без markdown:
[
  {
    "company_name": "Название компании",
    "contact_name": null,
    "phone": null,
    "instagram": "@аккаунт или null",
    "website": "сайт или null",
    "city": "Москва",
    "size_category": "small|medium|large",
    "potential_monthly": число в рублях (реалистичный потенциал для MGlass),
    "score": "A|B|C",
    "notes": "краткая гипотеза: почему они могут быть интересны и где их искать (2ГИС / Instagram / Авито)"
  }
]

Правила:
- company_name — реалистичное русское или латинское название московской компании
- instagram — придумай правдоподобный @handle если сегмент визуальный (дизайнеры, мебель), иначе null
- potential_monthly — реалистично для MGlass: дизайнеры 20k-150k, мебельщики 30k-100k, строители 50k-300k, алюминий 80k-250k
- score A = регулярные крупные заказы очевидны, B = есть потенциал, C = разово или мало
- notes — конкретно: где искать эту компанию и почему они могут купить у MGlass`

  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    system: 'Ты генерируешь реалистичные B2B проспект-листы для московской стекольной компании. Отвечаешь только валидным JSON.',
    messages: [{ role: 'user', content: prompt }],
  })

  const text = msg.content[0].type === 'text' ? msg.content[0].text : '[]'
  let leads: object[]
  try {
    leads = JSON.parse(text.replace(/```json\s*/gi, '').replace(/```/g, '').trim())
  } catch {
    return NextResponse.json({ error: 'AI вернул некорректный JSON' }, { status: 500 })
  }

  // Insert all leads
  const toInsert = leads.map((l: object) => ({
    ...(l as Record<string, unknown>),
    segment,
    status: 'new',
    source: 'manual',
    created_by: user.id,
  }))

  const { data, error } = await supabase.from('b2b_leads').insert(toInsert).select()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, count: data.length, leads: data })
}
