import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { consumeForItem, reverseItemConsume } from '@/lib/inventory/consumeHook'
import { isAttributable, planConsume, shouldReverse, type CuttingMark, type MarkSource, type ReopenReason } from './cuttingConsume'

// Мост «цех → склад»: единственное место, откуда производственный контур зовёт списание.
//
// Почему мост, а не вызов на месте. Закрыть резку можно тремя путями (очередь цеха, карточка
// заказа с QR-экраном, «Всё готово»), и правило «что списывает» размножилось бы по трём файлам.
// Это уже было со счётчиком «Всё готово», который считал не то же, что делал сервер.
// Решение живёт в cuttingConsume.ts (чистое, с тестами), вызов склада — здесь.
//
// best-effort по построению: склад никогда не бросает, а мы дополнительно не даём его ответу
// уронить отметку «Готово». Если цех перестанет отмечать из-за ошибок склада, мы потеряем
// данные о производстве ради данных о материале — размен в неверную сторону.

export type MarkedTask = {
  item_index:     number
  stage_key:      string
  rework_count:   number | null
}

export type ConsumeActor = { userId?: string; name?: string }

// Списание по закрытым этапам. Каскадные отметки передавать ОБЯЗАТЕЛЬНО: каскад утверждает,
// что этап физически был, просто его не отметили, — материал по нему израсходован.
// Имя при этом не подставляется: «неизвестно, КТО сделал» и «неизвестно, БЫЛО ли сделано» —
// разные утверждения, и каскад говорит первое.
export async function consumeCutting(
  orderId: number,
  tasks:   MarkedTask[],
  source:  MarkSource,
  actor:   ConsumeActor,
): Promise<number> {
  const marks: CuttingMark[] = tasks.map(t => ({
    orderId,
    itemIndex: t.item_index,
    stageKey:  t.stage_key,
    source,
    attempt:   t.rework_count ?? 0,
  }))
  const intents = planConsume(marks)
  if (intents.length === 0) return 0

  const by: ConsumeActor = isAttributable(source) ? actor : {}
  let consumed = 0
  for (const i of intents) {
    const r = await consumeForItem('b2b_order', String(orderId), i.itemIndex, i.attempt, by)
    if (r.ok && r.inserted > 0) consumed += r.inserted
  }
  return consumed
}

// Откат при переоткрытии резки. Различие делает cuttingConsume: мисклик откатываем (материал
// не расходовался), переделку нет (лист израсходован, дальше спишется следующая попытка).
export async function reverseCutting(
  orderId: number,
  tasks:   MarkedTask[],
  reason:  ReopenReason,
  actor:   ConsumeActor,
): Promise<number> {
  let reversed = 0
  for (const t of tasks) {
    if (!shouldReverse({ stageKey: t.stage_key, reason })) continue
    const r = await reverseItemConsume('b2b_order', String(orderId), t.item_index, t.rework_count ?? 0, actor)
    if (r.ok && r.inserted > 0) reversed += r.inserted
  }
  return reversed
}

// Каскад возвращает только ключи этапов — номер попытки надо дочитать из задач детали.
export async function loadCascadedTasks(
  svc:       SupabaseClient,
  orderId:   number,
  itemIndex: number,
  stageKeys: string[],
): Promise<MarkedTask[]> {
  if (stageKeys.length === 0) return []
  const { data } = await svc.from('production_tasks')
    .select('item_index, stage_key, rework_count')
    .eq('order_id', orderId).eq('item_index', itemIndex).in('stage_key', stageKeys)
  return (data ?? []) as MarkedTask[]
}
