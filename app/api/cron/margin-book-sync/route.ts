import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { notifyAdmins } from '@/lib/telegram'
import { formatMarginReport, syncMarginBook } from '@/lib/sales/marginBook'
import { withCronRun } from '@/lib/cronRuns'

export const maxDuration = 300

// Каждое утро в 8:10 МСК, после сверки продаж (8:00): книга «Маржа» → маржа
// объектов и себестоимость для витрины CFO. Отчёт владельцу — каждый день: что
// посчитано точно и что поправить в книгах.

async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const dry = new URL(req.url).searchParams.get('dry') === '1'
  const svc = createServiceClient()
  try {
    const report = await syncMarginBook(svc, { dry })
    if (!dry) await notifyAdmins(formatMarginReport(report)).catch(() => {})
    const months = report.months.map(m => ({ month: m.month, rows: m.rows, held: m.held, summary: m.summary }))
    return NextResponse.json({ ok: !report.error, error: report.error, financeUpdated: report.financeUpdated, months })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!dry) await notifyAdmins(`📐 <b>Маржа</b>\n⚠️ Сверка не прошла: ${msg}`).catch(() => {})
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export const GET = (req: NextRequest) => withCronRun('margin-book-sync', req, () => run(req))
