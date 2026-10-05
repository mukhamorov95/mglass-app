import { NextResponse } from 'next/server'
import { requireOwner } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'
import { collectManagerDay } from '@/lib/managerDayFetch'
import { mskDayKey } from '@/lib/time'

export const runtime = 'nodejs'
export const maxDuration = 60

// «Сегодня» на «Команде»: снимок незаконченного дня по тем же правилам, что утренний
// крон (только GET к amo и АТС). Пишется в manager_day_stats за сегодня — в 6:30
// крон перепишет его полным днём. Чаще раза в 5 минут amo не дёргаем.

const FRESH_MS = 5 * 60_000

export async function POST() {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard

  const today = mskDayKey(new Date())
  const sb = createServiceClient()
  const { data: last, error: readErr } = await sb.from('manager_day_stats').select('updated_at')
    .eq('day', today).order('updated_at', { ascending: false }).limit(1).maybeSingle()
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
  if (last?.updated_at && Date.now() - Date.parse(last.updated_at) < FRESH_MS) {
    return NextResponse.json({ ok: true, fresh: true, updatedAt: last.updated_at })
  }

  try {
    const snap = await collectManagerDay(sb, today)
    const now = new Date().toISOString()
    if (snap.rows.length) {
      const { error } = await sb.from('manager_day_stats')
        .upsert(snap.rows.map(r => ({ ...r, updated_at: now })), { onConflict: 'day,amo_user_id' })
        .select('amo_user_id')
      if (error) return NextResponse.json({ error: `запись: ${error.message}` }, { status: 500 })
    }
    return NextResponse.json({ ok: true, fresh: false, updatedAt: now, rows: snap.rows.length, problems: snap.problems })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 })
  }
}
