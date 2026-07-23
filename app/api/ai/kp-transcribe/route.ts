import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { transcribeRu } from '@/lib/transcribe'

// Голос → текст для модуля КП. Принимает audio (multipart form-data, поле 'file'),
// шлёт в OpenAI Whisper (запасной — Groq), возвращает расшифровку. Только залогиненным.
export async function POST(req: Request) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const inForm = await req.formData()
  const file = inForm.get('file')
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'no audio file' }, { status: 400 })
  }

  const r = await transcribeRu(file, 'kp-voice.webm')
  if (!r.ok) return NextResponse.json({ error: r.code, message: r.message }, { status: r.status })
  return NextResponse.json({ text: r.text })
}
