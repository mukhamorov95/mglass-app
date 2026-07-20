import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase-server'

export const maxDuration = 120

// Б4: голосовое предложение бухгалтера. Аудио → Whisper → расшифровка
// сохраняется ДОСЛОВНО (правило владельца: не перефразировать), затем Claude
// раскладывает её на пункты «вы хотите: 1, 2, 3» — бухгалтер подтверждает.
// Разбор — вспомогательный: если он упал, дословный текст всё равно сохранён.

const SYSTEM = `Ты помощник бухгалтерии стекольной компании M-Glass. Тебе дают ДОСЛОВНУЮ
расшифровку голосового сообщения бухгалтера (Алёна или Екатерина) — это предложение,
вопрос или замечание по деньгам: фонды, подфонды, заявки на оплату, платежи, ошибки в учёте.
Разложи сказанное на отдельные пункты — что именно человек хочет.
Верни СТРОГО JSON без комментариев:
{
 "summary": "одна фраза — суть в целом",
 "items": [ { "text": "конкретный пункт своими словами, но БЕЗ додумывания", "kind": "предложение|вопрос|проблема|задача" } ]
}
Правила: не выдумывай — если чего-то не прозвучало, не добавляй. Не объединяй разные
мысли в один пункт и не дроби одну мысль на несколько. Речь расшифрована автоматически,
явные ослышки восстанавливай по смыслу. Пиши по-русски, коротко.`

async function transcribe(audio: File): Promise<string> {
  const form = new FormData()
  form.append('file', audio, audio.name || 'note.webm')
  form.append('model', 'whisper-1')
  form.append('language', 'ru')
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(90_000),
  })
  if (!res.ok) throw new Error(`Расшифровка не удалась (${res.status})`)
  return ((await res.json() as { text?: string }).text ?? '').trim()
}

export async function POST(req: NextRequest) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  const { data: u } = await sb.from('users').select('role,name').eq('id', user.id).maybeSingle()
  const me = u as { role?: string; name?: string } | null
  if (!['accountant', 'cfo', 'admin', 'ceo'].includes(me?.role ?? '')) {
    return NextResponse.json({ error: 'Нет доступа' }, { status: 403 })
  }

  const form = await req.formData().catch(() => null)
  const audio = form?.get('audio') as File | null
  const textInput = String(form?.get('text') ?? '').trim()
  const unit = String(form?.get('unit') ?? 'ip') === 'ooo' ? 'ooo' : 'ip'
  if (!audio && !textInput) return NextResponse.json({ error: 'Нужно аудио или текст' }, { status: 400 })

  const { data: note, error: nErr } = await sb.from('accounting_notes').insert({
    unit, source: audio ? 'voice' : 'text',
    created_by: user.id, created_by_name: me?.name ?? user.email ?? null,
  }).select().single()
  if (nErr) return NextResponse.json({ error: nErr.message }, { status: 500 })

  try {
    const transcript = audio ? await transcribe(audio) : textInput
    if (!transcript) throw new Error('Пустая запись — ничего не расслышал')
    // Дословный текст сохраняем сразу, до разбора: он ценен сам по себе.
    await sb.from('accounting_notes').update({ transcript }).eq('id', note.id)

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const msg = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1200,
      system: SYSTEM,
      messages: [{ role: 'user', content: transcript }],
    })
    const raw = msg.content.find(b => b.type === 'text')?.text ?? '{}'
    const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as
      { summary?: string; items?: { text?: string; kind?: string }[] }
    const items = (parsed.items ?? [])
      .filter(i => i?.text?.trim())
      .map(i => ({ text: i.text!.trim(), kind: i.kind ?? 'предложение', done: false }))

    const { data: full } = await sb.from('accounting_notes')
      .update({ items, summary: parsed.summary ?? null }).eq('id', note.id).select().single()
    return NextResponse.json({ ok: true, note: full })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Не удалось разобрать'
    await sb.from('accounting_notes').update({ status: 'failed', error: message }).eq('id', note.id)
    const { data: full } = await sb.from('accounting_notes').select('*').eq('id', note.id).maybeSingle()
    return NextResponse.json({ error: message, note: full }, { status: 502 })
  }
}
