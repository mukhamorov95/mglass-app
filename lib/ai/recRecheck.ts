// Сверка через месяц после «сделано»: та же цифра, на которую опиралась рекомендация,
// за новый период. Без неё «сделано» — отметка о действии, а не о результате, и
// модель не узнаёт, какие её советы работают.

import type { SupabaseClient } from '@supabase/supabase-js'
import { collectFacts } from './recFacts'
import { changeText, type Fact, type RecRecheck, type Recommendation } from './recommendationTypes'

export const RECHECK_AFTER_DAYS = 30

export function dueForRecheck(r: Pick<Recommendation, 'status' | 'done_at' | 'evidence' | 'recheck_at'>, now: Date): boolean {
  if (r.status !== 'done' || !r.done_at || r.recheck_at || !r.evidence?.facts.length) return false
  return now.getTime() - Date.parse(r.done_at) >= RECHECK_AFTER_DAYS * 86_400_000
}

export function buildRecheck(r: Pick<Recommendation, 'evidence'>, current: Map<string, Fact>, now: Date): RecRecheck {
  return {
    at: now.toISOString(),
    items: (r.evidence?.facts ?? []).map(f => {
      const after = current.get(f.id)
      return { id: f.id, label: f.label, unit: f.unit, before: f.value, beforePeriod: f.period, after: after?.value ?? null, afterPeriod: after?.period ?? null }
    }),
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function recheckText(r: Pick<Recommendation, 'title' | 'done_at' | 'result_note' | 'evidence'>, rc: RecRecheck): string {
  const main = rc.items.find(i => i.id === r.evidence?.check) ?? rc.items[0]
  const rest = rc.items.filter(i => i !== main)
  const done = r.done_at ? `Сделано ${new Date(r.done_at).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })}${r.result_note ? `: ${esc(r.result_note)}` : ''}` : null
  return [
    `📏 <b>Сверка через месяц</b>: ${esc(r.title)}`,
    ...(done ? [done] : []),
    '',
    ...(main ? [`<b>${esc(main.label)}</b>: ${esc(changeText(main))}`] : []),
    ...rest.map(i => `• ${esc(i.label)}: ${esc(changeText(i))}`),
  ].join('\n')
}

// Из крона рекомендаций, раз в день. До SQL с колонкой evidence сверять нечего — тихо 0.
export async function runRechecks(sb: SupabaseClient, notify: (text: string) => Promise<unknown>, now = new Date()): Promise<number> {
  const { data, error } = await sb.from('ai_recommendations').select('*').eq('status', 'done').is('recheck_at', null).limit(50)
  if (error) {
    if (/recheck_at|evidence|does not exist|schema cache/i.test(error.message)) return 0
    throw new Error(error.message)
  }
  const due = ((data ?? []) as Recommendation[]).filter(r => dueForRecheck(r, now))
  if (!due.length) return 0
  const { facts } = await collectFacts(sb, now)
  const current = new Map(facts.map(f => [f.id, f]))
  let done = 0
  for (const r of due) {
    const rc = buildRecheck(r, current, now)
    const { data: upd, error: updErr } = await sb.from('ai_recommendations').update({ recheck: rc, recheck_at: rc.at }).eq('id', r.id).select('id')
    if (updErr || !upd?.length) continue
    await notify(recheckText(r, rc)).catch(() => {})
    done++
  }
  return done
}
