import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { collectDayFacts } from '@/lib/dayNotes/collect'
import { dayNote, teamSummary, type DayRun } from '@/lib/dayNotes/rules'
import { notifyAdmins } from '@/lib/telegram'
import { escapeHtml } from '@/lib/security/accessAudit'

// Вечерний разбор заявок «Продаж» за сутки (docs/LEAD_DAY_NOTES_ROUTE.md). Крон не авторизован
// middleware — проверяет свой секрет сам. Тумблер владельца — owner_strategy.amo_day_notes_mode:
// off — ничего; иначе пробный режим: итог владельцу в Telegram, в amo ничего не пишется
// (запись примечаний — этап B2). ?send=0 — посчитать без сообщения, для проверки.
export const runtime = 'nodejs'
export const maxDuration = 300

const DAY = 86400

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  try {
    const sb = createServiceClient()
    const { data: mode, error } = await sb.from('owner_strategy').select('value').eq('key', 'amo_day_notes_mode').maybeSingle()
    if (error) throw new Error(`Не прочитать тумблер: ${error.message}`)
    if ((mode as { value?: string } | null)?.value === 'off') return NextResponse.json({ ok: true, mode: 'off' })

    const now = Math.floor(Date.now() / 1000)
    const from = now - DAY
    const { facts, noDealMissed } = await collectDayFacts(from, now)
    const notes = facts.map(f => dayNote(f, now))
    const run: DayRun = { from, now, mode: 'dry', facts, notes, noDealMissed, written: 0 }

    if (new URL(req.url).searchParams.get('send') !== '0') await notifyAdmins(teamSummary(run))
    return NextResponse.json({
      ok: true, mode: run.mode, leads: facts.length, noDealMissed,
      notes: notes.map((n, i) => ({ leadId: n.leadId, responsible: facts[i].responsible, text: n.text })),
    })
  } catch (e) {
    console.error('[cron/day-notes]', e)
    await notifyAdmins(`❌ Итог дня не собран: ${escapeHtml(e instanceof Error ? e.message : String(e))}`)
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
