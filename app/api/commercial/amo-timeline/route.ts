import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { fetchTimeline } from '@/lib/amoTimelineFetch'
import { mskDayStart } from '@/lib/amoActivity'

export const runtime = 'nodejs'
export const maxDuration = 60

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

// Лента «что именно делал» за один день — по кнопке на числе действий.
export async function GET(req: Request) {
  const guard = await requireRole(['admin', 'ceo', 'commercial'])
  if (guard instanceof NextResponse) return guard

  const { searchParams } = new URL(req.url)
  const day = searchParams.get('day') ?? ''
  const amoUserId = Number(searchParams.get('amo_user_id'))
  if (!DAY_RE.test(day)) return NextResponse.json({ error: 'День — ГГГГ-ММ-ДД' }, { status: 400 })
  if (!Number.isInteger(amoUserId) || amoUserId <= 0) return NextResponse.json({ error: 'Неверный amo_user_id' }, { status: 400 })

  const from = mskDayStart(day)
  const to = Math.min(from + 86400, Math.floor(Date.now() / 1000))
  if (to <= from) return NextResponse.json({ error: 'Этот день ещё не начался' }, { status: 400 })

  try {
    return NextResponse.json({ items: await fetchTimeline(amoUserId, from, to) })
  } catch (e) {
    return NextResponse.json({ error: `AmoCRM не ответил: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
  }
}
