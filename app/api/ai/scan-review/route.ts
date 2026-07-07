import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase-server'

// Ревизия списка изделий по заметкам менеджера: какие позиции убрать
// (ложные срабатывания — бра вместо зеркала и т.п.). Текстовый вызов, без картинок.
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const REVIEW_SCHEMA: Anthropic.Tool.InputSchema = {
  type: 'object' as const,
  properties: {
    remove_indexes: {
      type: 'array',
      items: { type: 'number' },
      description: 'Индексы позиций (index из списка), которые по замечаниям менеджера нужно УДАЛИТЬ. Пусто, если удалять нечего',
    },
    comment: { type: 'string', description: 'Одной фразой: что удалено и почему (по-русски)' },
  },
  required: ['remove_indexes'],
}

export async function POST(req: Request) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { items, notes } = await req.json() as {
    items?: { index: number; title: string; page: number; kind: string; dimensions?: string; description?: string }[]
    notes?: string
  }
  if (!Array.isArray(items) || !items.length || !notes?.trim()) {
    return NextResponse.json({ remove_indexes: [] })
  }

  const list = items.map(it =>
    `index=${it.index}: ${it.title} [${it.kind}] стр. ${it.page}${it.dimensions ? `, ${it.dimensions}` : ''}${it.description ? ` — ${it.description.slice(0, 120)}` : ''}`
  ).join('\n')

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 800,
      system: 'Ты помогаешь менеджеру стекольной компании чистить список изделий, найденных AI в дизайн-проекте. ' +
        'По замечаниям менеджера определи, какие позиции — ложные срабатывания (например, бра/светильник принят за зеркало) и подлежат удалению. ' +
        'Удаляй ТОЛЬКО то, о чём менеджер явно говорит. Если замечания не про удаление — верни пустой список.',
      tools: [{ name: 'review', description: 'Результат ревизии', input_schema: REVIEW_SCHEMA }],
      tool_choice: { type: 'tool', name: 'review' },
      messages: [{ role: 'user', content: `Список изделий:\n${list}\n\nЗамечания менеджера: ${notes.trim().slice(0, 2000)}` }],
    })
    const tool = msg.content.find(c => c.type === 'tool_use')
    const input = (tool && tool.type === 'tool_use' ? tool.input : {}) as { remove_indexes?: unknown[]; comment?: string }
    return NextResponse.json({
      remove_indexes: Array.isArray(input.remove_indexes) ? input.remove_indexes.filter(n => typeof n === 'number') : [],
      comment: input.comment ?? '',
    })
  } catch {
    return NextResponse.json({ remove_indexes: [] })
  }
}
