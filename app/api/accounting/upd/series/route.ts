import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { getSessionUser } from '@/lib/getRole'
import { createServiceClient } from '@/lib/supabase-service'
import { writeLogForCurrentUser } from '@/lib/activityLog'
import { mskDayKey } from '@/lib/time'
import { UPD_ACCOUNTING_ROLES, loadUpdSeries, setUpdSeries } from '@/lib/b2b/updRegistry'

// Первый номер серии УПД на год (этап 8). Бухгалтер задаёт его в момент переключения:
// последний номер, выписанный программой, + 1. Меняется только до первой выдачи в году —
// это держит set_upd_series, здесь лишь понятный ответ.
export async function POST(req: Request) {
  const guard = await requireRole(UPD_ACCOUNTING_ROLES)
  if (guard instanceof NextResponse) return guard
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Нужно войти' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { year?: unknown; start?: unknown }
  const year = Number(body.year)
  const start = Number(body.start)
  const thisYear = Number(mskDayKey().slice(0, 4))
  if (!Number.isInteger(year) || (year !== thisYear && year !== thisYear + 1)) {
    return NextResponse.json({ error: `Год серии — ${thisYear} или ${thisYear + 1}` }, { status: 400 })
  }
  if (!Number.isInteger(start) || start < 1 || start > 999_999) {
    return NextResponse.json({ error: 'Первый номер — целое число от 1' }, { status: 400 })
  }

  const svc = createServiceClient()
  try {
    const before = (await loadUpdSeries(svc))?.find(s => s.year === year) ?? null
    const { data: prof } = await svc.from('users').select('name').eq('id', user.id).maybeSingle()
    const out = await setUpdSeries(svc, year, start, { id: user.id, name: (prof?.name as string | null) ?? user.email ?? null })
    if (!out.ok) {
      return NextResponse.json({
        code: out.code,
        error: out.code === 'pending_sql'
          ? 'Серия включится после SQL владельца (20261007_upd_registry.sql)'
          : `В ${year} году УПД уже выдавались — первый номер больше не меняется`,
      }, { status: 409 })
    }
    await writeLogForCurrentUser('upd.series_set', {
      entityType: 'upd_series', entityId: String(year),
      details: { year, start_number: start, previous: before?.start_number ?? null },
    })
    return NextResponse.json({ series: out.series })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
