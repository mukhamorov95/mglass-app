import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

// Диктовка сотрудника цеха → заявка на закупку, разложенная по полям.
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const SYSTEM = `Ты — помощник цеха стекольного производства M-Glass. Сотрудник голосом или текстом
говорит, что нужно купить (расходники, инструмент, фурнитура). Разбери в JSON (ТОЛЬКО JSON):
{
 "title": "что купить — коротко и по делу (напр. «Свёрла по стеклу 6 мм»)",
 "qty": "количество как сказано (напр. «5 шт», «2 упаковки»); null если не сказано",
 "link": "ссылка на товар, если продиктована; иначе null",
 "details": "уточнения: зачем, какое именно, чем заменить, срочность; null если нечего добавить"
}
Не выдумывай ссылку и количество, если их нет. title обязателен.`

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { text } = await req.json()
  if (!text?.trim()) return NextResponse.json({ error: 'text required' }, { status: 400 })

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 500,
      system: SYSTEM,
      messages: [{ role: 'user', content: text }],
    })
    const raw = msg.content.find(b => b.type === 'text')?.text ?? '{}'
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? '{}')
    return NextResponse.json({
      title: typeof parsed.title === 'string' ? parsed.title : '',
      qty: typeof parsed.qty === 'string' ? parsed.qty : '',
      link: typeof parsed.link === 'string' ? parsed.link : '',
      details: typeof parsed.details === 'string' ? parsed.details : '',
    })
  } catch {
    return NextResponse.json({ error: 'Не удалось разобрать — попробуй ещё раз или заполни вручную.' }, { status: 500 })
  }
}
