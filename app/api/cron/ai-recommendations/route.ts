import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { generateRecommendations, perspectiveForDay } from '@/lib/ai/recommendations'
import { notifyAdmins } from '@/lib/telegram'

// Ежедневные рекомендации AI Control Center. Если владелец не разобрал прошлые —
// новые не копим: рекомендация без решения ничего не меняет, а куча без решений
// превращается в шум, который перестают открывать.

export const maxDuration = 120

const MAX_UNDECIDED = 8

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const sb = createServiceClient()
  const { count } = await sb.from('ai_recommendations').select('id', { count: 'exact', head: true }).eq('status', 'new')
  if ((count ?? 0) >= MAX_UNDECIDED) {
    return NextResponse.json({ ok: true, skipped: 'undecided', undecided: count })
  }
  try {
    const created = await generateRecommendations(sb, { perspective: perspectiveForDay(), count: 3, source: 'cron' })
    if (created.length) {
      await notifyAdmins([
        `💡 <b>AI Control Center: новых рекомендаций — ${created.length}</b>`,
        ...created.map(r => `• ${r.title}`),
        '',
        'Решить: в работу / в архив / убрать — https://mglass-app.vercel.app/admin/ai-control-center',
      ].join('\n')).catch(() => {})
    }
    return NextResponse.json({ ok: true, created: created.length })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'error' }, { status: 500 })
  }
}
