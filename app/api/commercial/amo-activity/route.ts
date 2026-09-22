import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { fetchAmoActivity } from '@/lib/amoActivityFetch'
import { mskDay, mskDayStart } from '@/lib/amoActivity'
import { createServiceClient } from '@/lib/supabase-service'
import { summarizeWazzupOutgoing, type WazzupOutRow } from '@/lib/wazzupOutgoing'

export const runtime = 'nodejs'
export const maxDuration = 60

// Больше двух недель живьём из amo не тянем: ~1 000 событий в сутки, запрос уходит за минуту.
const MAX_DAYS = 14
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: Request) {
  const guard = await requireRole(['admin', 'ceo', 'commercial'])
  if (guard instanceof NextResponse) return guard

  const { searchParams } = new URL(req.url)
  const today = mskDay(Math.floor(Date.now() / 1000))
  const fromDay = searchParams.get('from') ?? today
  const toDay = searchParams.get('to') ?? fromDay
  if (!DAY_RE.test(fromDay) || !DAY_RE.test(toDay) || fromDay > toDay) {
    return NextResponse.json({ error: 'Период: from и to в формате ГГГГ-ММ-ДД, from не позже to' }, { status: 400 })
  }
  const from = mskDayStart(fromDay)
  const to = Math.min(mskDayStart(toDay) + 86400, Math.floor(Date.now() / 1000))
  if ((to - from) / 86400 > MAX_DAYS) {
    return NextResponse.json({ error: `Не больше ${MAX_DAYS} дней за раз` }, { status: 400 })
  }
  if (to <= from) return NextResponse.json({ error: 'Этот день ещё не начался' }, { status: 400 })

  try {
    const [report, wazzup] = await Promise.all([fetchAmoActivity(from, to), wazzupAuthors(from, to)])
    return NextResponse.json({ ...report, wazzup })
  } catch (e) {
    return NextResponse.json({ error: `AmoCRM не ответил: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
  }
}

// Исходящие Wazzup с автором копятся с 22.09.2026 — до этого их не сохраняли
async function wazzupAuthors(from: number, to: number) {
  const sb = createServiceClient()
  const [rows, first] = await Promise.all([
    sb.from('wazzup_outgoing_messages').select('author_name, sent_at')
      .gte('sent_at', new Date(from * 1000).toISOString()).lt('sent_at', new Date(to * 1000).toISOString())
      .limit(20000),
    sb.from('wazzup_outgoing_messages').select('received_at').order('received_at').limit(1).maybeSingle(),
  ])
  if (rows.error || first.error) return { error: (rows.error ?? first.error)!.message }
  return { since: first.data?.received_at ?? null, ...summarizeWazzupOutgoing((rows.data ?? []) as WazzupOutRow[]) }
}
