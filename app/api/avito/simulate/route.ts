import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { runAvitoManager, handoffReply, type DialogMsg, type LeadKnown } from '@/lib/ai-tools/avitoManagerRuntime'
import { createServiceClient } from '@/lib/supabase-service'
import { loadBotKnowledge } from '@/lib/knowledge/aiKnowledge'
import { decideNextAction } from '@/lib/avito/dispatcher'
import { FLAGS, type LeadFlags } from '@/lib/avito/flags'

// Песочница AI-менеджера Авито (/crm/bot-test): тот же движок и то же решение о
// передаче, что в вебхуке, но без записи в CRM и без отправки в Авито.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { history, known, flags } = await req.json().catch(() => ({})) as { history?: DialogMsg[]; known?: LeadKnown; flags?: LeadFlags }
  if (!Array.isArray(history) || history.length === 0) {
    return NextResponse.json({ error: 'history required' }, { status: 400 })
  }
  try {
    // Пробелы в знаниях песочница не пишет — это не настоящий клиент.
    const knowledge = await loadBotKnowledge(createServiceClient())
    const prev = flags ?? {}
    const turn = await runAvitoManager(history.slice(-40), known ?? {}, { knowledge, flags: prev })

    const merged: LeadFlags = { ...prev }
    for (const f of FLAGS) if (turn.flags[f.key]) merged[f.key] = true
    const dispatch = decideNextAction(merged)
    const handoff = dispatch.action === 'handoff' || dispatch.action === 'close_measure' || turn.needs_human
    const hasPhone = !!(turn.extracted.phone ?? known?.phone)
    const reply = handoff ? handoffReply(turn.reply, hasPhone) : turn.reply

    return NextResponse.json({
      ...turn, reply, flags: merged, handoff,
      decision: { action: dispatch.action, reason: turn.needs_human && dispatch.action === 'collect' ? 'нужен человек' : dispatch.reason },
      portrait: { done: dispatch.score.coreDone, total: dispatch.score.coreTotal, next: dispatch.score.missingNext },
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'AI error' }, { status: 500 })
  }
}
