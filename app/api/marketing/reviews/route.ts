import { NextResponse } from 'next/server'
import { requireOwner } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'
import { fillQueue, sendBatch } from '@/lib/reviewCampaign'
import { DAILY_LIMIT } from '@/lib/reviewMessage'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET() {
  const gate = await requireOwner()
  if (gate instanceof NextResponse) return gate

  const sb = createServiceClient()
  const { data } = await sb.from('review_requests').select('status')
  const counts: Record<string, number> = {}
  for (const r of data ?? []) counts[r.status] = (counts[r.status] ?? 0) + 1

  const { data: sentToday } = await sb.from('review_requests')
    .select('id', { count: 'exact', head: false })
    .eq('status', 'sent')
    .gte('sent_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString())

  return NextResponse.json({ counts, sentToday: sentToday?.length ?? 0, dailyLimit: DAILY_LIMIT })
}

export async function POST(req: Request) {
  const gate = await requireOwner()
  if (gate instanceof NextResponse) return gate

  const { action, limit } = await req.json().catch(() => ({ action: '' }))
  try {
    if (action === 'fill') return NextResponse.json(await fillQueue())
    if (action === 'send') {
      // Дневной лимит считаем здесь, а не в sendBatch: иначе два нажатия подряд
      // обойдут его и отправят две порции за день.
      const sb = createServiceClient()
      const { data: today } = await sb.from('review_requests')
        .select('id').eq('status', 'sent')
        .gte('sent_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString())
      const left = DAILY_LIMIT - (today?.length ?? 0)
      if (left <= 0) return NextResponse.json({ sent: 0, failed: 0, note: 'дневная норма уже отправлена' })
      return NextResponse.json(await sendBatch(Math.min(limit ?? left, left)))
    }
    return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
