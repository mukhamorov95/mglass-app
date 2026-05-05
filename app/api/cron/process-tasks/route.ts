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

// Process "config" type tasks automatically:
// These are tasks that only update AI knowledge/settings (no code changes needed)
async function processConfigTask(taskId: string, prompt: string): Promise<string> {
  const supabase = db()

  // Get current extra knowledge
  const { data: setting } = await supabase
    .from('ai_settings')
    .select('value')
    .eq('key', 'bot_extra_knowledge')
    .single()

  const currentKnowledge = setting?.value ?? ''

  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: `Ты обновляешь базу знаний AI-менеджера MGlass по имени Владислав.

ТЕКУЩИЕ ЗНАНИЯ:
${currentKnowledge || '(пусто)'}

ЗАДАЧА (что добавить/изменить):
${prompt}

Верни обновлённый текст знаний — кратко, по пунктам, только факты и правила поведения для менеджера. Максимум 500 слов. Не включай системные инструкции — только конкретные знания о компании, продуктах, ценах, правилах работы с клиентами.`,
    }],
  })

  const newKnowledge = msg.content[0].type === 'text' ? msg.content[0].text : currentKnowledge

  await supabase
    .from('ai_settings')
    .upsert({ key: 'bot_extra_knowledge', value: newKnowledge, updated_at: new Date().toISOString() })

  return `Знания AI-менеджера обновлены. Добавлено: ${prompt.slice(0, 100)}...`
}

export async function GET(req: Request) {
  // Allow cron invocation via Vercel cron or manual trigger
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = db()

  // Pick next pending config task
  const { data: tasks } = await supabase
    .from('task_queue')
    .select('id, title, prompt, type')
    .eq('status', 'pending')
    .eq('type', 'config')
    .order('created_at', { ascending: true })
    .limit(1)

  if (!tasks?.length) {
    return NextResponse.json({ ok: true, message: 'No pending config tasks' })
  }

  const task = tasks[0]

  // Mark in progress
  await supabase
    .from('task_queue')
    .update({ status: 'in_progress' })
    .eq('id', task.id)

  try {
    const result = await processConfigTask(task.id, task.prompt)

    await supabase.from('task_queue').update({
      status: 'done',
      result,
      done_at: new Date().toISOString(),
    }).eq('id', task.id)

    return NextResponse.json({ ok: true, processed: task.title, result })
  } catch (err) {
    await supabase.from('task_queue').update({
      status: 'failed',
      result: String(err),
    }).eq('id', task.id)

    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

// Also allow POST for manual trigger
export const POST = GET
