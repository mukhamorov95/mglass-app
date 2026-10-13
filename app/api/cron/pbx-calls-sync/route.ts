import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { withCronRun } from '@/lib/cronRuns'
import { isOnlinePbxConfigured, onlinePbxHistory } from '@/lib/onlinepbx'
import { pbxCallRow, pbxSyncWindow } from '@/lib/pbxCallsStore'

// Все звонки АТС в pbx_calls каждые 10 минут (С1, docs/B2C_CRM_ROUTE.md). Крон не
// авторизован middleware — проверяет свой секрет сам. ?days=N — догрузить N дней.
export const runtime = 'nodejs'
export const maxDuration = 60

async function run(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  if (!isOnlinePbxConfigured()) return NextResponse.json({ ok: true, skipped: 'pbx_not_configured' })
  try {
    const sb = createServiceClient()
    const { data: last, error: lastErr } = await sb
      .from('pbx_calls').select('started_at').order('started_at', { ascending: false }).limit(1).maybeSingle()
    if (lastErr) throw new Error(`pbx_calls: ${lastErr.message}`)
    const days = Number(new URL(req.url).searchParams.get('days')) || undefined
    const { from, to } = pbxSyncWindow((last as { started_at?: string } | null)?.started_at ?? null, Math.floor(Date.now() / 1000), days)

    const raw = await onlinePbxHistory(from, to)
    const rows = raw.map(pbxCallRow).filter(r => r !== null)
    if (rows.length) {
      const { error } = await sb.from('pbx_calls').upsert(rows, { onConflict: 'uuid' })
      if (error) throw new Error(`pbx_calls upsert: ${error.message}`)
    }
    return NextResponse.json({ ok: true, from, to, fetched: raw.length, saved: rows.length, unparsed: raw.length - rows.length })
  } catch (e) {
    console.error('[cron/pbx-calls-sync]', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export const GET = (req: Request) => withCronRun('pbx-calls-sync', req, () => run(req))
