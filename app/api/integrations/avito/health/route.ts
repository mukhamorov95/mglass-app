/**
 * GET /api/integrations/avito/health
 * Checks: DB connectivity, AmoCRM API, queue status, failed messages.
 */

import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export const maxDuration = 15

function db() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function checkDb(): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = db()
    const { error } = await supabase
      .from('message_queue')
      .select('id')
      .limit(1)
    return error ? { ok: false, error: error.message } : { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

async function checkAmo(): Promise<{ ok: boolean; error?: string }> {
  try {
    const url = `https://${process.env.AMO_SUBDOMAIN}.amocrm.ru/api/v4/account`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.AMO_ACCESS_TOKEN}` },
      cache: 'no-store',
    })
    if (res.ok) return { ok: true }
    return { ok: false, error: `HTTP ${res.status}` }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

async function checkWazzup(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('https://api.wazzup24.com/v3/channels', {
      headers: { Authorization: `Bearer ${process.env.WAZZUP_API_KEY}` },
      cache: 'no-store',
    })
    if (res.ok) return { ok: true }
    return { ok: false, error: `HTTP ${res.status}` }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

async function getQueueStats() {
  const supabase = db()
  const { data } = await supabase
    .from('message_queue')
    .select('status')

  const stats: Record<string, number> = {
    pending: 0, processing: 0, synced_to_amocrm: 0,
    ai_processed: 0, failed: 0, retry_scheduled: 0,
  }
  for (const row of data ?? []) {
    stats[row.status] = (stats[row.status] ?? 0) + 1
  }
  return stats
}

async function getRecentErrors(limit = 5) {
  const supabase = db()
  const { data } = await supabase
    .from('message_queue')
    .select('id, last_error, updated_at, raw_message_id')
    .in('status', ['failed', 'retry_scheduled'])
    .order('updated_at', { ascending: false })
    .limit(limit)
  return data ?? []
}

export async function GET() {
  const [dbCheck, amoCheck, wazzupCheck, queueStats, recentErrors] = await Promise.all([
    checkDb(),
    checkAmo(),
    checkWazzup(),
    getQueueStats(),
    getRecentErrors(),
  ])

  const allOk = dbCheck.ok && amoCheck.ok && wazzupCheck.ok && queueStats.failed === 0

  return NextResponse.json({
    status: allOk ? 'ok' : 'degraded',
    checks: {
      database: dbCheck,
      amocrm:   amoCheck,
      wazzup:   wazzupCheck,
    },
    queue:        queueStats,
    recentErrors,
    checkedAt:    new Date().toISOString(),
  }, { status: allOk ? 200 : 207 })
}
