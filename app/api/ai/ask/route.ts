import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase-server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { prompt, system } = await req.json() as { prompt: string; system?: string }

  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 2048,
    system: system ?? 'Ты — эксперт по продажам компании MGlass (зеркала, лофт-перегородки, душевые). Отвечай кратко, по делу, на русском языке.',
    messages: [{ role: 'user', content: prompt }],
  })

  const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
  return NextResponse.json({ text })
}
