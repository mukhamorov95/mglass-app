import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { collectCoaching } from '@/lib/coaching/collect'

// Снимок «Моего дня» считается кроном раз в утро: полный сбор — около минуты запросов к amo,
// на открытии страницы столько ждать нельзя. Клиент Supabase передаётся снаружи — проверка
// прав живёт в маршруте, который его создаёт.

export const TEAM_ROW = 0   // строка 0 — общие пропущенные, у которых нет хозяина

export async function refreshCoaching(sb: SupabaseClient) {
  // только продавцы B2C: остальных (владелец, сопровождение, офис) воронкой B2C не мерим
  const { data: schedules, error } = await sb.from('manager_schedules').select('amo_user_id, name').eq('is_seller', true)
  if (error) throw new Error(`Не прочитать графики: ${error.message}`)
  const managers = (schedules ?? []).map(s => ({ id: Number(s.amo_user_id), name: String(s.name) }))
  if (managers.length === 0) return { managers: 0, computedAt: null }

  const run = await collectCoaching(managers)
  const computedAt = new Date(run.computedAt * 1000).toISOString()
  const rows = run.coachings.map(c => ({ amo_user_id: c.amoUserId, name: c.name, computed_at: computedAt, payload: c }))
  rows.push({ amo_user_id: TEAM_ROW, name: 'Общая линия', computed_at: computedAt, payload: { unassignedMissed: run.unassignedMissed } as never })

  const { error: saveErr } = await sb.from('manager_coaching').upsert(rows, { onConflict: 'amo_user_id' })
  if (saveErr) throw new Error(`Не сохранить подсказки: ${saveErr.message}`)
  return { managers: managers.length, computedAt }
}
