import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { alertText, runLiveChecks } from '@/lib/health/liveChecks'
import { notifyAdmins } from '@/lib/telegram'
import { appUrl } from '@/lib/appUrl'

export const maxDuration = 60

// Тревога «что сломалось» — в 9:30 и 14:30 МСК. Пишет только при красном; пока
// поломка не устранена, это напоминание дважды в день (без таблицы состояния
// повторы не отличить — журнал состояний будет на этапе 1б маршрута).
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const checks = await runLiveChecks(createServiceClient())
  const text = alertText(checks, appUrl('/admin/ai-control-center'))
  if (text) await notifyAdmins(text)
  return NextResponse.json({ ok: true, alerted: !!text, checks: checks.map(c => ({ id: c.id, status: c.status })) })
}
