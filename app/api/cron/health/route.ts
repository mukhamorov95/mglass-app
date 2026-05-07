import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const maxDuration = 30

// In-memory last-alert cache — prevents spam if Vercel instance is warm
let lastAlertAt = 0

async function sendTelegram(chatId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  })
}

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const checks: Record<string, boolean> = {}
  const issues: string[] = []

  // Supabase
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    const { error } = await supabase.from('materials').select('id').limit(1)
    checks.supabase = !error
    if (error) issues.push(`Supabase DB: ${error.message}`)
  } catch (e) {
    checks.supabase = false
    issues.push(`Supabase недоступен: ${String(e)}`)
  }

  // API keys
  checks.anthropic = !!process.env.ANTHROPIC_API_KEY
  checks.telegram  = !!process.env.TELEGRAM_BOT_TOKEN
  checks.openai    = !!process.env.OPENAI_API_KEY

  if (!checks.anthropic) issues.push('ANTHROPIC_API_KEY не задан')
  if (!checks.telegram)  issues.push('TELEGRAM_BOT_TOKEN не задан')

  const allOk = issues.length === 0

  // Send alert (max once per hour)
  if (!allOk && process.env.TELEGRAM_BOT_TOKEN) {
    const now = Date.now()
    const silencePeriod = 60 * 60 * 1000 // 1 hour

    if (now - lastAlertAt > silencePeriod) {
      lastAlertAt = now

      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
      )
      const { data: admins } = await supabase
        .from('telegram_users')
        .select('telegram_id, users!inner(role)')
        .eq('users.role', 'admin')

      const msg = [
        '🚨 <b>MGlass Alert</b>',
        '',
        ...issues.map(i => `— ${i}`),
        '',
        '👉 <a href="https://vercel.com/dashboard">Vercel Dashboard</a>',
      ].join('\n')

      for (const a of (admins ?? [])) {
        await sendTelegram((a as any).telegram_id, msg)
      }
    }
  }

  return NextResponse.json({ ok: allOk, checks, issues, ts: new Date().toISOString() })
}
