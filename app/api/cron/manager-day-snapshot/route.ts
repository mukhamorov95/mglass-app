import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { notifyAdmins } from '@/lib/telegram'
import { mskDayKeyAgo } from '@/lib/time'
import { collectManagerDay } from '@/lib/managerDayFetch'

export const runtime = 'nodejs'
export const maxDuration = 300

// Каждое утро в 6:30 МСК: вчерашний день каждого менеджера → manager_day_stats
// (docs/MANAGER_MORNING_ROUTE.md, М1). Повтор перезаписывает тот же день.
// Догон: ?day=2026-10-02&days=3 — три дня по 02.10 включительно, не больше 5 за вызов.
// ?dry=1 — посчитать один день и вернуть строки, ничего не записывая. Владельцу пишем только о сбое.

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_DAYS = 5

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const sp = new URL(req.url).searchParams
  const dry = sp.get('dry') === '1'
  const last = sp.get('day') ?? mskDayKeyAgo(1)
  const count = dry ? 1 : Math.min(MAX_DAYS, Math.max(1, Number(sp.get('days') ?? 1) || 1))
  if (!DAY_RE.test(last) || last >= mskDayKeyAgo(0)) {
    return NextResponse.json({ error: 'day — прошедший день в формате ГГГГ-ММ-ДД' }, { status: 400 })
  }
  const days = Array.from({ length: count }, (_, i) =>
    new Date(Date.parse(`${last}T00:00:00Z`) - (count - 1 - i) * 86_400_000).toISOString().slice(0, 10))

  const sb = createServiceClient()
  const done: { day: string; rows: number; problems: string[] }[] = []
  try {
    for (const day of days) {
      const snap = await collectManagerDay(sb, day)
      if (!dry && snap.rows.length) {
        const now = new Date().toISOString()
        const { error } = await sb.from('manager_day_stats')
          .upsert(snap.rows.map(r => ({ ...r, updated_at: now })), { onConflict: 'day,amo_user_id' })
        if (error) throw new Error(`запись ${day}: ${error.message}`)
      }
      done.push({ day, rows: snap.rows.length, problems: snap.problems })
      if (dry) return NextResponse.json({ ok: true, dry, done, rows: snap.rows })
    }
    const problems = done.flatMap(d => d.problems.map(p => `${d.day}: ${p}`))
    if (problems.length && !dry) {
      await notifyAdmins(`☀️ <b>Снимок дня менеджеров</b>\nЗаписан, но не полностью:\n${problems.join('\n')}`).catch(() => {})
    }
    return NextResponse.json({ ok: true, dry, done })
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e)
    if (!dry) await notifyAdmins(`☀️ <b>Снимок дня менеджеров</b>\n⚠️ Не собран: ${m}`).catch(() => {})
    return NextResponse.json({ ok: false, error: m, done }, { status: 500 })
  }
}
