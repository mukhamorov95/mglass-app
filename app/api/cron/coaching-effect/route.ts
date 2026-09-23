import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { mskDay } from '@/lib/amoActivity'
import { collectEvidence, scoreCoaching } from '@/lib/coaching/effect'
import type { Coaching } from '@/lib/coaching/rules'

// Вечерний замер: сколько утренних поводов закрыто. Крон не авторизован middleware —
// проверяет свой секрет сам.
export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const sb = createServiceClient()
  const { data, error } = await sb.from('manager_coaching').select('amo_user_id, name, computed_at, payload').gt('amo_user_id', 0)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const rows = data ?? []
  const now = Math.floor(Date.now() / 1000)
  const today = mskDay(now)
  const fresh = rows.filter(r => mskDay(Math.floor(new Date(r.computed_at).getTime() / 1000)) === today)
  if (fresh.length === 0) return NextResponse.json({ ok: true, skipped: 'снимка за сегодня нет' })

  try {
    const since = Math.min(...fresh.map(r => Math.floor(new Date(r.computed_at).getTime() / 1000)))
    const ev = await collectEvidence(since, now)
    const out = fresh.map(r => {
      const c = r.payload as Coaching
      const s = scoreCoaching(c, ev)
      return { day: today, amo_user_id: r.amo_user_id, name: r.name, items: s.items, done: s.done, by_kind: s.byKind, checked_at: new Date(now * 1000).toISOString() }
    })
    const { error: saveErr } = await sb.from('coaching_effect').upsert(out, { onConflict: 'day,amo_user_id' })
    if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 })
    return NextResponse.json({ ok: true, day: today, managers: out.map(o => `${o.name} ${o.done}/${o.items}`) })
  } catch (e) {
    console.error('[cron/coaching-effect]', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
