import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { createClient } from '@/lib/supabase-server'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

export const maxDuration = 120

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const formData = await req.formData()
    const file = formData.get('audio') as File | null

    if (!file) return NextResponse.json({ error: 'No audio file' }, { status: 400 })

    const transcription = await openai.audio.transcriptions.create({
      file,
      model:    'whisper-1',
      language: 'ru',
    })

    return NextResponse.json({ transcription: transcription.text ?? '' })
  } catch (err) {
    console.error('[transcribe] error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
