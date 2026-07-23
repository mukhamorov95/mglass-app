import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase-server'
import { transcribeRu } from '@/lib/transcribe'

export const maxDuration = 90

// Голосовая заявка на монтаж: аудио → Whisper → Claude раскладывает по полям
// формы. Модель НИЧЕГО не выдумывает: поле не прозвучало — null.

const SYSTEM = `Ты разбираешь надиктованную заявку на монтаж стекольной компании M-Glass.
Верни СТРОГО JSON без комментариев:
{
 "order_no": "номер заказа (например 0715-2)" | null,
 "title": "что монтируем (изделие)" | null,
 "client_name": "ФИО клиента" | null,
 "phone": "телефон" | null,
 "address": "адрес" | null,
 "entry_note": "пропуск/как попасть" | null,
 "scheduled_date": "YYYY-MM-DD, пересчитай «завтра»/«в среду» от сегодня {TODAY}" | null,
 "time_from": "HH:MM" | null,
 "time_to": "HH:MM" | null,
 "contact_before": "за сколько связаться с клиентом (например «за 30 минут»)" | null,
 "amount": число — сумма монтажа в рублях | null,
 "order_total": число — сумма заказа в рублях | null,
 "comment": "остальное важное, что не легло в поля" | null
}
Правила: не выдумывай — чего не прозвучало, то null. Речь расшифрована автоматически,
ослышки восстанавливай по смыслу. Телефон — цифрами. «Окно с 10 до 13» → time_from 10:00, time_to 13:00.`

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const form = await req.formData().catch(() => null)
  const audio = form?.get('audio') as File | null
  if (!audio) return NextResponse.json({ error: 'Нужно аудио' }, { status: 400 })

  // Расшифровка: OpenAI Whisper с запасным Groq (см. lib/transcribe). При исчерпании
  // квоты OpenAI отдаём понятную ошибку, а не «Расшифровка не удалась (429)».
  const stt = await transcribeRu(audio, audio.name || 'note.webm')
  if (!stt.ok) return NextResponse.json({ error: stt.message }, { status: stt.status })
  const transcript = stt.text

  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' })
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const msg = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 800,
      system: SYSTEM.replace('{TODAY}', today),
      messages: [{ role: 'user', content: transcript }],
    })
    const text = msg.content.find(b => b.type === 'text')?.text ?? '{}'
    const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
    return NextResponse.json({ ok: true, transcript, fields: parsed })
  } catch {
    return NextResponse.json({ error: 'Разбор не удался', transcript }, { status: 500 })
  }
}
