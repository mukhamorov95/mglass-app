import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { runAvitoManager, type DialogMsg, type LeadKnown } from '@/lib/ai-tools/avitoManagerRuntime'

// Песочница AI-менеджера Авито (/crm/bot-test): тот же движок, что в вебхуке,
// но без записи в CRM и без отправки в Авито — безопасная проверка тона и логики.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { history, known } = await req.json().catch(() => ({})) as { history?: DialogMsg[]; known?: LeadKnown }
  if (!Array.isArray(history) || history.length === 0) {
    return NextResponse.json({ error: 'history required' }, { status: 400 })
  }
  try {
    const turn = await runAvitoManager(history.slice(-40), known ?? {})
    return NextResponse.json(turn)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'AI error' }, { status: 500 })
  }
}
