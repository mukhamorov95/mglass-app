import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { buildContentGeneratorPrompt, DAILY_CONTENT_PROMPT } from '@/lib/contentGeneratorPrompt'

export const maxDuration = 120

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

function extractJSON(text: string): string {
  // Strip markdown code fences
  const s = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
  // Find outermost { ... }
  const first = s.indexOf('{')
  const last  = s.lastIndexOf('}')
  if (first !== -1 && last !== -1 && last > first) {
    return s.slice(first, last + 1)
  }
  return s
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    mode?: 'script' | 'daily'
    content_type?: string
    topic?: string
    goal?: string
    context?: string
    stream?: boolean
  }

  const isDaily = body.mode === 'daily'
  const prompt = isDaily
    ? DAILY_CONTENT_PROMPT
    : buildContentGeneratorPrompt(
        body.content_type ?? 'reels',
        body.topic ?? 'shower',
        body.goal ?? 'leads',
        body.context ?? ''
      )

  // Streaming mode: client gets text chunks, parses JSON at the end
  if (body.stream) {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: object) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))

        try {
          let fullText = ''
          const apiStream = anthropic.messages.stream({
            model: 'claude-sonnet-5',
            max_tokens: 8000,
            messages: [{ role: 'user', content: prompt }],
          })

          apiStream.on('text', (chunk) => {
            fullText += chunk
            send({ type: 'chunk', text: chunk })
          })

          await apiStream.finalMessage()

          const cleaned = extractJSON(fullText)
          try {
            const parsed = JSON.parse(cleaned)
            send({ type: 'done', result: parsed })
          } catch (parseErr) {
            console.error('[content-generate] JSON parse failed. Length:', fullText.length)
            console.error('[content-generate] First 200 chars:', fullText.slice(0, 200))
            console.error('[content-generate] Last 200 chars:', fullText.slice(-200))
            console.error('[content-generate] Parse error:', parseErr)
            send({ type: 'error', error: 'Не удалось распарсить JSON — попробуйте ещё раз.' })
          }
        } catch (err) {
          send({ type: 'error', error: err instanceof Error ? err.message : 'Ошибка генерации' })
        } finally {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  }

  // Non-streaming fallback
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
    const cleaned = extractJSON(text)
    const parsed = JSON.parse(cleaned)
    return NextResponse.json(parsed)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'AI generation failed' },
      { status: 500 }
    )
  }
}
