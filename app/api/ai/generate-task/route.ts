import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(req: Request) {
  try {
    const { voiceInput } = await req.json() as { voiceInput: string }
    if (!voiceInput?.trim()) return NextResponse.json({ error: 'empty' }, { status: 400 })

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: `Ты — технический менеджер проекта MGlass. Владелец компании надиктовал идею по улучшению AI-системы или бизнеса.

Твоя задача: превратить идею в чёткую задачу для разработчика (Claude Code AI).

ИДЕЯ:
"${voiceInput}"

Определи тип задачи:
- "config" — если задача только об изменении поведения AI (что говорить боту, какие знания добавить, изменить промт, добавить факт о компании). Эти задачи выполняются автоматически.
- "code" — если нужно создать/изменить страницу, добавить функционал, поменять логику кода.

Ответь строго в JSON без markdown:
{
  "title": "короткое название задачи (до 60 символов)",
  "type": "config" или "code",
  "prompt": "детальный промт для исполнителя (Claude Code) — что именно сделать, какой результат ожидается. Для config-задач: что добавить/изменить в знаниях AI-менеджера Владислава. Для code-задач: подробное техническое задание."
}`,
      }],
    })

    const raw = msg.content[0].type === 'text' ? msg.content[0].text : ''
    let task: { title: string; type: 'config' | 'code'; prompt: string }

    try {
      const match = raw.match(/\{[\s\S]*\}/)
      task = JSON.parse(match?.[0] ?? '{}')
    } catch {
      task = { title: voiceInput.slice(0, 60), type: 'code', prompt: voiceInput }
    }

    // Save to queue
    const { data } = await db().from('task_queue').insert({
      title: task.title,
      voice_input: voiceInput,
      prompt: task.prompt,
      type: task.type,
      status: 'pending',
    }).select('id').single()

    return NextResponse.json({ ...task, id: data?.id })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
