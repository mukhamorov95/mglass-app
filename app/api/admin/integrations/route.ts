/**
 * /api/admin/integrations
 *
 * GET  — returns stats + last 50 messages + recent errors
 * POST — actions: { action: 'retry', queueId: '...' } | { action: 'retry_all_failed' }
 */

import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getOwnerUser } from '@/lib/requireOwner'

function db() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET() {
  const owner = await getOwnerUser()
  if (!owner) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const supabase = db()

  const [queueRes, rawRes] = await Promise.all([
    supabase
      .from('message_queue')
      .select('id, status, attempts, last_error, amo_lead_id, created_at, updated_at, raw_message_id'),
    supabase
      .from('avito_messages_raw')
      .select('id, chat_id, chat_type, direction, message_type, text, contact_name, received_at, processing_status, error_message, wazzup_message_id')
      .order('received_at', { ascending: false })
      .limit(50),
  ])

  const queueItems = queueRes.data ?? []
  const rawMessages = rawRes.data ?? []

  // Compute stats from queue
  const stats = {
    total_received:       rawMessages.length,  // approximation (limited to last 50)
    pending:              0,
    processing:           0,
    synced_to_amocrm:     0,
    ai_processed:         0,
    failed:               0,
    retry_scheduled:      0,
  }
  for (const q of queueItems) {
    const s = q.status as keyof typeof stats
    if (s in stats) (stats as Record<string, number>)[s]++
  }

  // Build a quick lookup: raw_message_id → queue item
  const queueByRawId = new Map<string, (typeof queueItems)[0]>()
  for (const q of queueItems) queueByRawId.set(q.raw_message_id, q)

  // Enrich raw messages with their queue status
  const messages = rawMessages.map(r => ({
    ...r,
    queue: queueByRawId.get(r.id) ?? null,
  }))

  // Recent errors
  const errors = queueItems
    .filter(q => q.status === 'failed' || q.status === 'retry_scheduled')
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 20)

  return NextResponse.json({ stats, messages, errors })
}

export async function POST(req: Request) {
  const owner = await getOwnerUser()
  if (!owner) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const body = await req.json() as { action: string; queueId?: string }
  const supabase = db()

  if (body.action === 'retry' && body.queueId) {
    const { error } = await supabase
      .from('message_queue')
      .update({ status: 'pending', next_retry_at: null, updated_at: new Date().toISOString() })
      .eq('id', body.queueId)
      .in('status', ['failed', 'retry_scheduled', 'synced_to_amocrm'])
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'retry_all_failed') {
    const { error } = await supabase
      .from('message_queue')
      .update({ status: 'pending', next_retry_at: null, attempts: 0, updated_at: new Date().toISOString() })
      .eq('status', 'failed')
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'run_processor') {
    try {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
      const res = await fetch(`${baseUrl}/api/cron/process-queue`, {
        method: 'POST',
        headers: process.env.CRON_SECRET
          ? { Authorization: `Bearer ${process.env.CRON_SECRET}` }
          : {},
      })
      const text = await res.text()
      let result: unknown = null
      try { result = JSON.parse(text) } catch { result = { raw: text.slice(0, 200) } }
      return NextResponse.json({ ok: res.ok, result })
    } catch (e) {
      return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: false, error: 'unknown action' }, { status: 400 })
}
