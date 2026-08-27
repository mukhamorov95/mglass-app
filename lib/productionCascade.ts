import type { SupabaseClient } from '@supabase/supabase-js'

// Отметка этапа = все предыдущие этапы этой детали физически уже сделаны:
// нельзя закалить нерезаное и упаковать несверлёное. Поэтому когда мастер
// закрывает свой этап, все более ранние закрываются автоматически.
// auto_closed отделяет каскад от живой отметки — в метриках цеха видно, где
// мастера отмечают по ходу, а где всё «догоняется» в конце.
// completed_by каскадным задачам НЕ ставим сознательно (П1): их физически никто
// не отмечал, и приписать их одному человеку — исказить выработку (П16).

export type CascadedStage = { item_index: number; stage_key: string }

// Откат каскада. Снятие отметки трогает только СВОЮ задачу — этапы, закрытые каскадом от неё,
// оставались закрытыми, и заказ показывал «сделано» там, где отметку уже сняли. С переносом
// списания на резку (27.08) у этой лжи появилась цена: мисклик по упаковке закрывал каскадом
// резку, списывал материал, а снятие отметки его не возвращало.
//
// Признак «того же каскада» — ДВА условия, и одной метки времени мало.
//
// 1) completed_at: каскад проставляет его тем же значением, что и вызвавшая отметка.
// 2) sequence_order МЕНЬШЕ снимаемого этапа: каскад по построению закрывает только
//    предыдущие этапы.
//
// Почему без второго нельзя. `now` в sync-stages вычисляется ОДИН РАЗ на весь запрос, а цикл
// обрабатывает несколько обновлений. Закрыли одним запросом полировку и закалку — оба каскада
// проставят ОДИНАКОВЫЙ completed_at. Тогда снятие полировки переоткрыло бы и то, что каскадила
// закалка: заказ показал бы открытое сверление при закрытой закалке — новая ложь вместо старой,
// только тише.
// Сегодняшние вызывающие шлют один этап на много позиций, поэтому случай не воспроизводится —
// но условие стоит строки, а гарантия остаётся при любом будущем вызывающем.
//
// Живые отметки не трогаем в любом случае: только auto_closed, их ставил не человек.

export type ReversibleTask = { id: number; stage_key: string; sequence_order: number }

export function pickCascadeReversal(
  tasks: ReversibleTask[],
  beforeSequenceOrder: number | null,
): ReversibleTask[] {
  if (beforeSequenceOrder == null) return []
  return tasks.filter(t => t.sequence_order < beforeSequenceOrder)
}

export async function reverseCascade(
  svc: SupabaseClient,
  orderId: number,
  itemIndex: number,
  completedAt: string | null,
  beforeSequenceOrder: number | null,
): Promise<string[]> {
  if (!completedAt || beforeSequenceOrder == null) return []
  const { data } = await svc
    .from('production_tasks')
    .select('id, stage_key, sequence_order')
    .eq('order_id', orderId)
    .eq('item_index', itemIndex)
    .eq('auto_closed', true)
    .eq('completed_at', completedAt)
    .lt('sequence_order', beforeSequenceOrder)
  const rows = pickCascadeReversal((data ?? []) as ReversibleTask[], beforeSequenceOrder)
  if (rows.length === 0) return []
  await svc.from('production_tasks')
    .update({ status: 'queued', completed_at: null, completed_by: null, completed_by_name: null,
              started_at: null, started_by: null, started_by_name: null, started_via: null,
              auto_closed: false })
    .in('id', rows.map(r => r.id))
  return rows.map(r => r.stage_key)
}

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
