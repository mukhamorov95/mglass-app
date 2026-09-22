import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { fetchAmoResults } from '@/lib/amoResultsFetch'
import { mskDay, mskDayStart } from '@/lib/amoActivity'

export const runtime = 'nodejs'
export const maxDuration = 60

// Результат — на длинном окне: оплат у человека единицы в месяц, за неделю выводов не сделать.
const ALLOWED_DAYS = new Set([30, 90])

export async function GET(req: Request) {
  const guard = await requireRole(['admin', 'ceo', 'commercial'])
  if (guard instanceof NextResponse) return guard

  const days = Number(new URL(req.url).searchParams.get('days') ?? 30)
  if (!ALLOWED_DAYS.has(days)) return NextResponse.json({ error: 'Период: 30 или 90 дней' }, { status: 400 })

  // Полные сутки по сегодняшнее утро: сегодняшние заявки ещё не успели ни во что превратиться
  const to = mskDayStart(mskDay(Math.floor(Date.now() / 1000)))
  try {
    return NextResponse.json(await fetchAmoResults(to - days * 86400, to))
  } catch (e) {
    return NextResponse.json({ error: `AmoCRM не ответил: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
  }
}
