import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { generateRecommendations, perspectiveForDay } from '@/lib/ai/recommendations'
import { notifyAdmins, notifyAdminsWithKeyboard } from '@/lib/telegram'
import { recKeyboard, recText } from '@/lib/ai/recTelegram'
import { runRechecks } from '@/lib/ai/recRecheck'
import { aiErrorText } from '@/lib/health/liveChecks'
import { withCronRun } from '@/lib/cronRuns'

// Ежедневные рекомендации AI Control Center. Если владелец не разобрал прошлые —
// новые не копим: рекомендация без решения ничего не меняет, а куча без решений
// превращается в шум, который перестают открывать.

export const maxDuration = 120

const MAX_UNDECIDED = 8

async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const sb = createServiceClient()
  // Сверка сделанных — раньше проверки на нерешённые: она не зависит от новых рекомендаций.
  const rechecked = await runRechecks(sb, t => notifyAdmins(t)).catch(() => 0)
  const { count } = await sb.from('ai_recommendations').select('id', { count: 'exact', head: true }).eq('status', 'new')
  if ((count ?? 0) >= MAX_UNDECIDED) {
    // Напоминание по понедельникам и четвергам, а не каждый день: куча без решений
    // видна и так, ежедневный повтор учит его пролистывать.
    const day = new Date(Date.now() + 3 * 3_600_000).getUTCDay()
    if (day === 1 || day === 4) {
      await notifyAdminsWithKeyboard(
        `💡 <b>Ждут решения: ${count} рекомендаций AI.</b> Новые не создаются, пока эти не разобраны.`,
        [[{ text: '💡 Разобрать здесь', callback_data: 'recs:list' }]],
      ).catch(() => {})
    }
    return NextResponse.json({ ok: true, skipped: 'undecided', undecided: count, rechecked })
  }
  try {
    const created = await generateRecommendations(sb, { perspective: perspectiveForDay(), count: 3, source: 'cron' })
    for (const r of created) await notifyAdminsWithKeyboard(recText(r), recKeyboard(r)).catch(() => {})
    return NextResponse.json({ ok: true, created: created.length, rechecked })
  } catch (e) {
    return NextResponse.json({ ok: false, error: aiErrorText(e) }, { status: 500 })
  }
}

export const GET = (req: NextRequest) => withCronRun('ai-recommendations', req, () => run(req))
