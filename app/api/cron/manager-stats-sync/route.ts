import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { notifyAdmins } from '@/lib/telegram'
import { mskDayKey } from '@/lib/time'
import { formatManagerStatsReport, syncManagerStats } from '@/lib/sales/managerStatsSync'
import { withCronRun } from '@/lib/cronRuns'

export const maxDuration = 120

// Каждое утро в 8:05 МСК: «Аналитика дохода» → поступления, разговоры и замеры по
// менеджерам и дням (docs/MANAGER_MORNING_ROUTE.md, М4). Владельцу пишем, только
// когда есть что сделать. ?dry=1 — без записи; ?since=2026-01-01 — догон.

async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const sp = new URL(req.url).searchParams
  const dry = sp.get('dry') === '1'
  const since = sp.get('since') ?? undefined
  if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    return NextResponse.json({ error: 'since — ГГГГ-ММ-ДД' }, { status: 400 })
  }
  const today = mskDayKey()
  try {
    const report = await syncManagerStats(createServiceClient(), { dry, since, today })
    const text = formatManagerStatsReport(report, today)
    if (text && !dry) await notifyAdmins(text).catch(() => {})
    return NextResponse.json({ ok: !report.error && !report.held, ...report, odd: report.odd.length })
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e)
    if (!dry) await notifyAdmins(`📒 <b>Аналитика дохода</b>\n⚠️ Не загрузилась: ${m}`).catch(() => {})
    return NextResponse.json({ ok: false, error: m }, { status: 500 })
  }
}

export const GET = (req: NextRequest) => withCronRun('manager-stats-sync', req, () => run(req))
