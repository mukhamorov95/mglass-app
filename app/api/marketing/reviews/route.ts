import { NextResponse } from 'next/server'
import { requireOwner } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'
import { fillQueue, sendBatch, sentToday, whatsappChannels } from '@/lib/reviewCampaign'
import { DAILY_LIMIT } from '@/lib/reviewMessage'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET() {
  const gate = await requireOwner()
  if (gate instanceof NextResponse) return gate

  const sb = createServiceClient()
  const { data, error } = await sb.from('review_requests').select('status')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const counts: Record<string, number> = {}
  for (const r of data ?? []) counts[r.status] = (counts[r.status] ?? 0) + 1

  return NextResponse.json({ counts, sentToday: await sentToday(sb), dailyLimit: DAILY_LIMIT, channels: await whatsappChannels() })
}

export async function POST(req: Request) {
  const gate = await requireOwner()
  if (gate instanceof NextResponse) return gate

  const { action, channelId } = await req.json().catch(() => ({ action: '' }))
  try {
    if (action === 'fill') return NextResponse.json(await fillQueue())
    if (action === 'send') {
      if (typeof channelId !== 'string' || !channelId) {
        return NextResponse.json({ error: 'не выбран номер, с которого писать' }, { status: 400 })
      }
      // Норма проверяется и здесь, и перед каждым сообщением в sendBatch: две вкладки
      // разом иначе отправили бы две порции за день.
      const left = DAILY_LIMIT - await sentToday(createServiceClient())
      if (left <= 0) return NextResponse.json({ sent: 0, failed: 0, pending: null, left: 0, note: 'дневная норма уже отправлена' })
      return NextResponse.json(await sendBatch(channelId, left))
    }
    return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
