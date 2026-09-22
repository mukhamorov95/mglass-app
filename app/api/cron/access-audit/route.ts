import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { notifyAdmins } from '@/lib/telegram'
import { auditAccess, countBySeverity, escapeHtml, formatReport, type AccessSnapshot, type Finding } from '@/lib/security/accessAudit'

// Ежемесячный прогон «кто что видит» (решение владельца 22.09.2026).
// Снимок прав берёт SQL-функция, выводы делает lib/security/accessAudit.
// Результат ложится в security_audit_runs и уходит владельцу в телеграм —
// с пометкой, что появилось нового с прошлого прогона.
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: Request) {
  try {
    if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

    const { data: snap, error } = await sb.rpc('security_access_snapshot')
    if (error || !snap) {
      await notifyAdmins(`⚠️ Прогон доступов не выполнился: ${escapeHtml(error?.message ?? 'пустой снимок')}`)
      return NextResponse.json({ error: error?.message ?? 'no snapshot' }, { status: 500 })
    }

    const findings = auditAccess(snap as AccessSnapshot)
    const counts = countBySeverity(findings)

    const { data: prevRow } = await sb.from('security_audit_runs')
      .select('findings').order('created_at', { ascending: false }).limit(1).maybeSingle()
    const prev = (prevRow?.findings ?? null) as Finding[] | null

    const { error: insErr } = await sb.from('security_audit_runs').insert({
      findings, ...counts, snapshot: snap,
    })
    // Supabase не бросает: без этой проверки прогон «прошёл», а в админке пусто.
    const saveNote = insErr ? `\n\n⚠️ Результат не сохранился в базе: ${escapeHtml(insErr.message)}` : ''

    await notifyAdmins(formatReport(findings, prev) + saveNote)
    if (insErr) return NextResponse.json({ error: insErr.message, ...counts }, { status: 500 })
    return NextResponse.json({ ok: true, ...counts, total: findings.length })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await notifyAdmins(`⚠️ Прогон доступов упал: ${escapeHtml(msg)}`).catch(() => {})
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
