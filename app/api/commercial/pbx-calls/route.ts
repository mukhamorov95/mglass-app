import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { fetchPbxReport } from '@/lib/pbxCallsFetch'
import { mskDay, mskDayStart } from '@/lib/amoActivity'

export const runtime = 'nodejs'
export const maxDuration = 60

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: Request) {
  const guard = await requireRole(['admin', 'ceo', 'commercial'])
  if (guard instanceof NextResponse) return guard

  const { searchParams } = new URL(req.url)
  const now = Math.floor(Date.now() / 1000)
  const fromDay = searchParams.get('from') ?? mskDay(now)
  const toDay = searchParams.get('to') ?? fromDay
  if (!DAY_RE.test(fromDay) || !DAY_RE.test(toDay) || fromDay > toDay) {
    return NextResponse.json({ error: 'Период: from и to в формате ГГГГ-ММ-ДД' }, { status: 400 })
  }
  const from = mskDayStart(fromDay)
  const to = Math.min(mskDayStart(toDay) + 86400, now)
  if ((to - from) / 86400 > 31) return NextResponse.json({ error: 'Не больше 31 дня за раз' }, { status: 400 })
  if (to <= from) return NextResponse.json({ error: 'Этот день ещё не начался' }, { status: 400 })

  try {
    return NextResponse.json(await fetchPbxReport(from, to))
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 })
  }
}
