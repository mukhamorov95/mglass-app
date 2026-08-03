import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { requireOwner } from '@/lib/apiAuth'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function applyToBotKnowledge(supabase: ReturnType<typeof db>, newFact: string) {
  const { data } = await supabase.from('ai_settings').select('value').eq('key', 'bot_extra_knowledge').single()
  const current = data?.value?.trim() || ''
  const updated = current ? `${current}\n\n${newFact}` : newFact
  await supabase.from('ai_settings').upsert({ key: 'bot_extra_knowledge', value: updated, updated_at: new Date().toISOString() })
}

export async function POST(req: Request) {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard
  try {
    const { content, noteId } = await req.json() as { content: string; noteId?: string }
    if (!content?.trim()) return NextResponse.json({ error: 'empty' }, { status: 400 })

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 900,
      messages: [{
        role: 'user',
        content: `Ты — личный тренер по продажам менеджера MGlass (зеркала, перегородки, душевые). Менеджер надиктовал заметку о своём опыте — клиентах, сделках, наблюдениях, что сработало, что нет.

ЗАМЕТКА:
${content}

Дай краткий и полезный анализ. Ответь строго в JSON без markdown-блоков:
{
  "summary": "одно предложение — суть заметки",
  "insights": ["вывод 1", "вывод 2", "вывод 3"],
  "actions": ["конкретное действие 1", "конкретное действие 2"],
  "for_bot": "что важно знать AI-менеджеру Владиславу из этой заметки (1-2 предложения)"
}`,
      }],
    })

    const raw = msg.content[0].type === 'text' ? msg.content[0].text : ''
    let analysis: { summary: string; insights: string[]; actions: string[]; for_bot: string }

    try {
      const match = raw.match(/\{[\s\S]*\}/)
      analysis = JSON.parse(match?.[0] ?? '{}')
    } catch {
      analysis = { summary: raw.slice(0, 200), insights: [], actions: [], for_bot: '' }
    }

    // Save or update note
    const supabase = db()
    if (noteId) {
      await supabase.from('manager_notes').update({
        ai_summary:  analysis.summary,
        ai_insights: analysis.insights,
        ai_actions:  analysis.actions,
        ai_for_bot:  analysis.for_bot,
      }).eq('id', noteId)
    } else {
      const { data } = await supabase.from('manager_notes').insert({
        content,
        ai_summary:  analysis.summary,
        ai_insights: analysis.insights,
        ai_actions:  analysis.actions,
        ai_for_bot:  analysis.for_bot,
      }).select('id').single()

      // Auto-apply to bot knowledge if there's something for the bot
      if (analysis.for_bot?.trim()) {
        await applyToBotKnowledge(supabase, analysis.for_bot)
      }

      return NextResponse.json({ ...analysis, id: data?.id })
    }

    return NextResponse.json(analysis)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
