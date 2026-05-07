import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { buildContentGeneratorPrompt, DAILY_CONTENT_PROMPT } from '@/lib/contentGeneratorPrompt'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

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

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed = JSON.parse(cleaned)
    return NextResponse.json(parsed)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'AI generation failed' },
      { status: 500 }
    )
  }
}
