import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

// Голос → текст для модуля КП. Принимает audio (multipart form-data, поле 'file'),
// шлёт в OpenAI Whisper (ru), возвращает расшифровку. Только для залогиненных.
export async function POST(req: Request) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'OPENAI_API_KEY not set' }, { status: 500 })
  }

  const inForm = await req.formData()
  const file = inForm.get('file')
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'no audio file' }, { status: 400 })
  }

  const whAbort = new AbortController()
  const whTimer = setTimeout(() => whAbort.abort(), 60_000)
  try {
    const form = new FormData()
    form.append('file', file, 'kp-voice.webm')
    form.append('model', 'whisper-1')
    form.append('language', 'ru')

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
      signal: whAbort.signal,
    })
    clearTimeout(whTimer)

    if (!res.ok) {
      const body = await res.text().catch(() => '?')
      return NextResponse.json({ error: `whisper_${res.status}`, detail: body.slice(0, 200) }, { status: 502 })
    }
    const json = await res.json() as { text?: string }
    return NextResponse.json({ text: json.text ?? '' })
  } catch (e) {
    clearTimeout(whTimer)
    const isAbort = e instanceof Error && e.name === 'AbortError'
    return NextResponse.json({ error: isAbort ? 'timeout' : 'transcribe_failed' }, { status: 504 })
  }
}
