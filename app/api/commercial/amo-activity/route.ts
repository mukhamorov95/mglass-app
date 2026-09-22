import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { fetchAmoActivity } from '@/lib/amoActivityFetch'
import { mskDay, mskDayStart } from '@/lib/amoActivity'

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
    return NextResponse.json(await fetchAmoActivity(from, to))
  } catch (e) {
    return NextResponse.json({ error: `AmoCRM не ответил: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
  }
}
