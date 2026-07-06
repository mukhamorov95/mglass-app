import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase-server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

// Обращение рабочего (голос → текст) → структура: проблема / предложенное решение / подсказка.
const SCHEMA = {
  type: 'object' as const,
  properties: {
    problem:  { type: 'string', description: 'Суть проблемы, кратко и по делу, от третьего лица. Если проблемы нет (просто идея) — что предлагается улучшить.' },
    solution: { type: 'string', description: 'Решение, которое предложил сам работник. Пусто, если он его не предлагал.' },
    hint:     { type: 'string', description: '1–3 коротких практических предложения от себя: что ещё можно сделать в этой ситуации на стекольном производстве (безопасно, дёшево, реализуемо). Не повторять решение работника.' },
  },
} as const

const SYS =
  'Ты — опытный технолог и наставник на стекольном производстве M-Glass (резка, полировка, сверловка, закалка, триплекс, упаковка). ' +
  'Рабочий надиктовал обращение: проблема на производстве и, возможно, своё решение. Разбери его на «проблему» и «решение работника» ' +
  'без искажений смысла (не выдумывай то, чего он не говорил), исправь только речевые огрехи диктовки. ' +
  'Затем дай короткую практичную подсказку от себя (hint) — что ещё можно попробовать. Пиши по-русски, просто и уважительно.'

export async function POST(req: Request) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { text } = await req.json() as { text?: string }
  if (!text?.trim()) return NextResponse.json({ error: 'no text' }, { status: 400 })

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1000,
      system: SYS,
      tools: [{ name: 'idea', description: 'Структурированное обращение', input_schema: SCHEMA }],
      tool_choice: { type: 'tool', name: 'idea' },
      messages: [{ role: 'user', content: `Обращение рабочего (расшифровка диктовки):\n${text.slice(0, 4000)}` }],
    })
    const tool = msg.content.find(c => c.type === 'tool_use')
    if (!tool || tool.type !== 'tool_use') return NextResponse.json({ error: 'no_structure' }, { status: 502 })
    return NextResponse.json({ parsed: tool.input })
  } catch (e) {
    const d = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: 'parse_failed', detail: d.slice(0, 200) }, { status: 502 })
  }
}
