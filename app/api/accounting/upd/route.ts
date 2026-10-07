import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'
import { mskDayKey } from '@/lib/time'
import { UPD_ACCOUNTING_ROLES, loadUpdRegistry, loadUpdSeries, loadUpdYearNumbers } from '@/lib/b2b/updRegistry'
import { registryXlsx, updRegistryCsv, updRegistryTotals, updSeriesGaps } from '@/lib/b2b/updRegistryCsv'
import { loadUpdQueue } from '@/lib/accounting/updWaiting'

// «Бухгалтерия → УПД» (этап 8 docs/b2b/ORDER_PANEL_ROUTE.md): реестр выданных УПД за период,
// выгрузка для книги продаж, серия номеров и «ждут УПД».

const DAY = /^\d{4}-\d{2}-\d{2}$/

function monthBounds(today: string) {
  const [y, m] = today.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${today.slice(0, 7)}-01`, to: `${today.slice(0, 7)}-${String(last).padStart(2, '0')}` }
}

export async function GET(req: NextRequest) {
  const guard = await requireRole(UPD_ACCOUNTING_ROLES)
  if (guard instanceof NextResponse) return guard

  const sp = req.nextUrl.searchParams
  const today = mskDayKey()
  const def = monthBounds(today)
  const from = sp.get('from') ?? def.from
  const to = sp.get('to') ?? def.to
  if (!DAY.test(from) || !DAY.test(to) || from > to) return NextResponse.json({ error: 'Период: from и to в формате ГГГГ-ММ-ДД' }, { status: 400 })
  if (Date.parse(to) - Date.parse(from) > 366 * 86400e3) return NextResponse.json({ error: 'Период — не больше года' }, { status: 400 })
  const format = sp.get('format')

  const svc = createServiceClient()
  try {
    const rows = await loadUpdRegistry(svc, from, to)

    if (format === 'csv' || format === 'xlsx') {
      if (rows === null) return NextResponse.json({ error: 'Реестр появится после SQL владельца (20261007_upd_registry.sql)' }, { status: 409 })
      const name = `УПД ${from}—${to}`
      const ascii = `upd-${from}-${to}`
      if (format === 'csv') {
        return new NextResponse(updRegistryCsv(rows), {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="${ascii}.csv"; filename*=UTF-8''${encodeURIComponent(name)}.csv`,
            'Cache-Control': 'no-store',
          },
        })
      }
      return new NextResponse(new Uint8Array(await registryXlsx(rows)), {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${ascii}.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}.xlsx`,
          'Cache-Control': 'no-store',
        },
      })
    }

    const series = await loadUpdSeries(svc)
    if (rows === null || series === null) {
      return NextResponse.json({ pendingSql: true, from, to, today, series: [], rows: [], totals: null, gaps: [], queue: null })
    }

    const year = Number(today.slice(0, 4))
    const cur = series.find(s => s.year === year) ?? null
    const gaps = cur ? updSeriesGaps(cur.start_number, await loadUpdYearNumbers(svc, year)) : []
    const queue = cur ? await loadUpdQueue(svc, mskDayKey(cur.set_at), year) : null

    return NextResponse.json({ pendingSql: false, from, to, today, series, rows, totals: updRegistryTotals(rows), gaps, queue })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
