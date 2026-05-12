import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase-server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export async function POST(req: Request) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { template_id, client_id } = await req.json() as { template_id: number; client_id: number }
  if (!template_id || !client_id) return NextResponse.json({ error: 'template_id and client_id required' }, { status: 400 })

  const [{ data: tpl }, { data: client }, { data: ints }] = await Promise.all([
    sb.from('b2b_outreach_templates').select('title,body,cta,channel,stage').eq('id', template_id).single(),
    sb.from('b2b_clients').select('name,contact,crm_segment,crm_city,crm_notes,discount_percent').eq('id', client_id).single(),
    sb.from('b2b_interactions').select('type,note,outcome').eq('client_id', client_id).order('created_at', { ascending: false }).limit(5),
  ])

  if (!tpl || !client) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const recentHistory = (ints ?? [])
    .map((i: { type: string; note: string; outcome: string | null }) => `- ${i.type}: ${i.note}${i.outcome ? ` → ${i.outcome}` : ''}`)
    .join('\n') || 'Нет истории'

  const prompt = `Персонализируй шаблон сообщения для конкретного клиента. Сохрани структуру и стиль оригинала, но добавь личные детали.

Клиент:
- Название: ${client.name}
- Контакт: ${client.contact ?? '—'}
- Сегмент: ${client.crm_segment ?? '—'}
- Город: ${(client as Record<string, unknown>).crm_city ?? '—'}
- Скидка: ${client.discount_percent ?? 0}%
- Заметка: ${(client as Record<string, unknown>).crm_notes ?? '—'}

Последние 5 взаимодействий:
${recentHistory}

Оригинальный шаблон (канал: ${tpl.channel}, этап: ${tpl.stage}):
${tpl.body}${tpl.cta ? `\n\n${tpl.cta}` : ''}

Правила персонализации:
1. Обращайся к контактному лицу по имени (если есть в поле contact)
2. Упомяни город или специфику бизнеса клиента если знаешь
3. Если есть скидка — намекни на особые условия
4. Учти тон последних взаимодействий
5. Сохрани длину и структуру оригинала
6. Отвечай ТОЛЬКО текстом сообщения, без пояснений`

  const message = await anthropic.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 600,
    messages:   [{ role: 'user', content: prompt }],
  })

  const personalized = (message.content[0] as { type: string; text: string }).text.trim()
  const original = tpl.cta ? `${tpl.body}\n\n${tpl.cta}` : tpl.body

  return NextResponse.json({ personalized, original })
}
