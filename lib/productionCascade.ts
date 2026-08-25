import type { SupabaseClient } from '@supabase/supabase-js'

// Отметка этапа = все предыдущие этапы этой детали физически уже сделаны:
// нельзя закалить нерезаное и упаковать несверлёное. Поэтому когда мастер
// закрывает свой этап, все более ранние закрываются автоматически.
// auto_closed отделяет каскад от живой отметки — в метриках цеха видно, где
// мастера отмечают по ходу, а где всё «догоняется» в конце.
// completed_by каскадным задачам НЕ ставим сознательно (П1): их физически никто
// не отмечал, и приписать их одному человеку — исказить выработку (П16).

export type CascadedStage = { item_index: number; stage_key: string }

export async function cascadePriorStages(
  svc: SupabaseClient,
  orderId: number,
  itemIndex: number,
  sequenceOrder: number,
  now: string,
): Promise<string[]> {
  const { data } = await svc
    .from('production_tasks')
    .select('id, stage_key')
    .eq('order_id', orderId)
    .eq('item_index', itemIndex)
    .lt('sequence_order', sequenceOrder)
    .neq('status', 'done')
  const prior = (data ?? []) as { id: number; stage_key: string }[]
  if (prior.length === 0) return []

  const ids = prior.map(p => p.id)
  const base = { status: 'done', completed_at: now, problem_resolved_at: now }
  const { error } = await svc.from('production_tasks').update({ ...base, auto_closed: true }).in('id', ids)
  // Колонка могла ещё не попасть в кэш схемы PostgREST — этапы всё равно закрываем.
  if (error) await svc.from('production_tasks').update(base).in('id', ids)

  return prior.map(p => p.stage_key)
}
