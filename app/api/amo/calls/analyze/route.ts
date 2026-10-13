import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { createClient } from '@/lib/supabase-server'

// Анализ остаётся в call_analyses; в AmoCRM ничего не пишем — CRM только на чтение.
const AMO_TOKEN = process.env.AMO_ACCESS_TOKEN!

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
const openai    = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

export const maxDuration = 300

async function transcribeAudio(url: string): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY || !url) return null

  try {
    // Download audio file from AMO
    // onPBX and similar PBX services embed their own signed token in the URL —
    // sending the AMO Bearer token to them causes auth errors
    const isAmoUrl = url.includes('amocrm.ru')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 300_000)
    const audioRes = await fetch(url, {
      headers: isAmoUrl ? { Authorization: `Bearer ${AMO_TOKEN}` } : {},
      signal: controller.signal,
    }).finally(() => clearTimeout(timer))
    if (!audioRes.ok) {
      console.error(`[call-analyze] audio download failed: ${audioRes.status} ${url.slice(0, 80)}`)
      return null
    }

    const arrayBuffer = await audioRes.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Detect format from URL extension
    const ext = url.split('?')[0].split('.').pop()?.toLowerCase() ?? 'mp3'
    const mimeMap: Record<string, string> = {
      mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
      m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac',
    }
    const mime = mimeMap[ext] ?? 'audio/mpeg'

    const file = new File([buffer], `call.${ext}`, { type: mime })

    const transcription = await openai.audio.transcriptions.create({
      file,
      model:    'whisper-1',
      language: 'ru',
    })

    return transcription.text ?? null
  } catch (err) {
    console.error('[call-analyze] whisper error:', err)
    return null
  }
}

const ANALYSIS_SYSTEM = `Ты — аналитик продаж компании MGlass (производство зеркал с подсветкой, душевых перегородок, лофт-перегородок).
Анализируешь звонки менеджеров с клиентами. Отвечай строго в JSON.`

const ANALYSIS_SCHEMA = `{
  "client_needs": ["список потребностей клиента"],
  "sizes": "упомянутые размеры или null",
  "product_interest": "конкретный продукт или 'не определено'",
  "objections": ["список возражений клиента"],
  "deal_probability": число от 0 до 100,
  "next_step": "конкретный следующий шаг",
  "recommended_message": "готовый текст сообщения клиенту (WhatsApp, 2-3 предложения)",
  "tasks": ["задача 1 для менеджера", "задача 2"],
  "summary": "краткое резюме звонка 3-4 предложения",
  "manager_score": число от 1 до 10,
  "manager_feedback": "конкретная обратная связь менеджеру — что хорошо, что улучшить"
}`

async function analyzeTranscription(transcription: string, direction: 'in' | 'out', durationSec: number) {
  const dirLabel = direction === 'in' ? 'входящий' : 'исходящий'
  const durLabel = `${Math.floor(durationSec / 60)} мин ${durationSec % 60} сек`

  const prompt = `Звонок: ${dirLabel}, длительность ${durLabel}.

РАСШИФРОВКА:
${transcription}

Проанализируй и верни JSON строго по схеме:
${ANALYSIS_SCHEMA}

Требования:
- deal_probability: реальная оценка, 0 если клиент явно отказал, 80+ только если клиент готов к сделке
- recommended_message: живой WhatsApp текст от лица Владислава, без официоза
- manager_score: объективно, 7+ только за действительно хорошую работу
- tasks: конкретные действия (позвонить повторно через X дней, отправить КП, уточнить размеры и т.д.)`

  const msg = await anthropic.messages.create({
    model:      'claude-sonnet-5',
    max_tokens: 1500,
    system:     ANALYSIS_SYSTEM,
    messages:   [{ role: 'user', content: prompt }],
  })

  const raw = msg.content[0].type === 'text' ? msg.content[0].text : ''

  // Extract JSON from response
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('Claude did not return valid JSON')

  return JSON.parse(match[0])
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    lead_id:       number
    note_id:       number
    direction:     'in' | 'out'
    duration_sec:  number
    phone?:        string
    recording_url?: string
    call_date?:    number
    transcription?: string  // manual paste override
  }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { lead_id, note_id, direction, duration_sec, recording_url, call_date, phone } = body

  if (!lead_id || !note_id) {
    return NextResponse.json({ error: 'lead_id and note_id required' }, { status: 400 })
  }

  try {
    // 1. Transcribe (or use manually pasted text)
    let transcription = body.transcription?.trim() ?? null

    if (!transcription && recording_url) {
      transcription = await transcribeAudio(recording_url)
    }

    if (!transcription) {
      return NextResponse.json({
        error: 'no_transcription',
        message: 'Не удалось получить расшифровку. Вставьте текст вручную.',
      }, { status: 422 })
    }

    // 2. Analyze with Claude
    const analysis = await analyzeTranscription(transcription, direction, duration_sec ?? 0)

    // 3. Save to local DB
    const { data: saved, error: saveErr } = await supabase
      .from('call_analyses')
      .upsert({
        amo_lead_id:         lead_id,
        amo_note_id:         note_id,
        call_date:           call_date ? new Date(call_date * 1000).toISOString() : null,
        duration_sec:        duration_sec ?? null,
        phone:               phone ?? null,
        direction,
        recording_url:       recording_url ?? null,
        transcription,
        summary:             analysis.summary,
        client_needs:        analysis.client_needs ?? [],
        objections:          analysis.objections ?? [],
        recommended_message: analysis.recommended_message,
        tasks:               analysis.tasks ?? [],
        next_step:           analysis.next_step,
        probability:         analysis.deal_probability,
        manager_score:       analysis.manager_score,
        raw_analysis:        analysis,
        updated_at:          new Date().toISOString(),
      }, { onConflict: 'amo_note_id' })
      .select('id')
      .single()

    if (saveErr) throw saveErr

    return NextResponse.json({
      ok:           true,
      analysis_id:  saved?.id,
      transcription,
      analysis,
    })
  } catch (err) {
    console.error('[call-analyze] error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
