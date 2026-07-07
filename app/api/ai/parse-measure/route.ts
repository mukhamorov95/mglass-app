import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { buildMeasureStructured } from '@/lib/measureStructured'

// Диктовка/вставка менеджера → структурированная заявка на замер.
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const SYSTEM = `Ты — диспетчер замеров стекольной компании M-Glass (зеркала, душевые, лофт-перегородки).
Менеджер диктует или вставляет заявку на замер в свободной форме. Разбери её в JSON (ТОЛЬКО JSON, без пояснений):
{
 "deal_number": "номер сделки вида 0008-6, если есть, иначе null",
 "client_name": "имя клиента",
 "phone": "телефон в формате +7…, если есть",
 "amo_url": "ссылка на amocrm, если есть",
 "address": "адрес",
 "scope": "что мерить: изделие, размеры, особенности — кратко и точно, сохраняя технические детали (осветлённое, от стены до зелёной зоны, подсветка и т.п.)",
 "notes": "прочее важное: доступ, домофон, этаж, пожелания по времени; null если нет",
 "visit_price": число ₽ за выезд (0 если бесплатно/не указано),
 "payer": "кто платит (имя клиента / включено в договор / компания)",
 "is_repeat": true если это повторный замер (слова «повторный», «перезамер», «ещё раз»)
}`

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { text } = await req.json()
  if (!text?.trim()) return NextResponse.json({ error: 'text required' }, { status: 400 })

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 700,
      system: SYSTEM,
      messages: [{ role: 'user', content: text }],
    })
    const raw = msg.content.find(b => b.type === 'text')?.text ?? '{}'
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? '{}')
    return NextResponse.json({ ...parsed, structured_text: buildMeasureStructured(parsed) })
  } catch {
    return NextResponse.json({ error: 'Не удалось разобрать — попробуй ещё раз или заполни вручную.' }, { status: 500 })
  }
}
