// Рекомендации AI Control Center в Telegram: каждая — отдельным сообщением с кнопками
// решения. За три недели (17.09–06.10) на странице не принято ни одного решения из 9,
// а крон рекомендаций сам встал на 8 нерешённых. Решение должно случаться там, где
// владелец читает, — в боте.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { InlineKeyboard } from '@/lib/telegram'
import { appUrl } from '@/lib/appUrl'
import { PERSPECTIVES, REC_STATUS_LABEL, type RecStatus, type Recommendation } from './recommendationTypes'

export type TgDecision = 'in_work' | 'archived' | 'removed' | 'new'

// callback_data у Telegram — до 64 байт: «rec:archived:» + uuid = 49.
export function parseRecCallback(data: string): { status: TgDecision; id: string } | null {
  const m = /^rec:(in_work|archived|removed|new):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(data)
  return m ? { status: m[1] as TgDecision, id: m[2] } : null
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const PRIORITY: Record<string, string> = { critical: '🔴 критично', high: '🟠 важно', medium: '🟡 средне', low: '⚪ низко' }
const STATUS_ICON: Record<RecStatus, string> = { new: '⏳', in_work: '🔧', done: '✅', archived: '📦', removed: '✖' }

export function recText(r: Recommendation): string {
  const lens = PERSPECTIVES.find(p => p.id === r.perspective)?.label
  const meta = [PRIORITY[r.priority], r.category, lens && `взгляд: ${lens}`].filter(Boolean).join(' · ')
  const lines = [
    `💡 <b>${esc(r.title)}</b>`,
    esc(meta),
    r.problem && `\n<b>Проблема.</b> ${esc(r.problem)}`,
    r.action && `<b>Что сделать.</b> ${esc(r.action)}`,
    r.metric && `<b>Как проверить.</b> ${esc(r.metric)}`,
  ]
  if (r.status !== 'new') {
    lines.push('', `${STATUS_ICON[r.status]} <b>${REC_STATUS_LABEL[r.status]}</b>${r.decided_by ? ` · ${esc(r.decided_by)}` : ''}`)
  }
  return lines.filter(Boolean).join('\n')
}

// Без решения — три кнопки. После решения — «Вернуть» на случай промаха пальцем;
// «Сделано» ставится на странице: там пишется, какой получился результат.
export function recKeyboard(r: Pick<Recommendation, 'id' | 'status'>): InlineKeyboard {
  if (r.status === 'new') {
    return [[
      { text: '🔧 В работу', callback_data: `rec:in_work:${r.id}` },
      { text: '📦 Архив', callback_data: `rec:archived:${r.id}` },
      { text: '✖ Убрать', callback_data: `rec:removed:${r.id}` },
    ]]
  }
  const page = { text: r.status === 'in_work' ? '✅ Отметить сделанным' : 'Открыть', url: appUrl('/admin/ai-control-center') }
  return r.status === 'done' ? [[page]] : [[{ text: '↩ Вернуть', callback_data: `rec:new:${r.id}` }, page]]
}

// Одна запись решения для страницы и для бота — чтобы они не разошлись.
export async function decideRecommendation(
  sb: SupabaseClient, id: string, status: RecStatus, decidedBy: string | null, resultNote?: string,
): Promise<Recommendation | null> {
  const now = new Date().toISOString()
  const patch: Record<string, unknown> = { status, updated_at: now, decided_at: now, decided_by: decidedBy }
  if (status === 'done') {
    patch.done_at = now
    if (typeof resultNote === 'string') patch.result_note = resultNote.trim().slice(0, 1000) || null
  }
  const { data, error } = await sb.from('ai_recommendations').update(patch).eq('id', id).select('*')
  if (error) throw new Error(error.message)
  return (data?.[0] ?? null) as Recommendation | null
}

const RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }

export async function undecidedRecommendations(sb: SupabaseClient): Promise<Recommendation[]> {
  const { data, error } = await sb.from('ai_recommendations').select('*').eq('status', 'new')
    .order('created_at', { ascending: true }).limit(100)
  if (error) throw new Error(error.message)
  return ((data ?? []) as Recommendation[]).sort((a, b) => (RANK[a.priority] ?? 9) - (RANK[b.priority] ?? 9))
}
