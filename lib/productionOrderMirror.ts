import type { SupabaseClient } from '@supabase/supabase-js'

// Третье зеркало: когда все позиционные задачи этапа (production_tasks) закрыты,
// проставляем order-level флаг notes.stages, который читают /b2b-orders и Сводка.
// Ключи флагов — как в /b2b-orders (STAGES): cut / edge_processed / drilled /
// tempering / packaged. Только ПРОДВИГАЕМ статус (ставим дату), никогда не
// снимаем — чтобы не затирать ручные отметки в /b2b-orders.
//
// Запись идёт через RPC mark_order_stages: точечно по ключу этапа и под
// блокировкой строки. Раньше здесь был блоб — весь notes читался, правился и
// клался обратно, — и две одновременные отметки по одному заказу затирали друг
// друга вместе с оплатой, доставкой и рекламацией, которые живут в том же notes.
// Это была последняя выжившая блоб-запись notes в репозитории.
//
// Формат значения — календарная дата YYYY-MM-DD, как у остальных писателей
// (см. 20260830_order_stages_atomic.sql). Здесь до этого писался полный ISO,
// из-за чего в notes.stages сосуществовали три формата разом и сравнения дат
// в отчётах вели себя непредсказуемо.

const STAGE_TO_FLAG: Record<string, string> = {
  cutting: 'cut',
  polishing: 'edge_processed',
  drilling: 'drilled',
  tempering: 'tempering',
  packaging: 'packaged',
  // curved — нет order-level эквивалента, пропускаем
}

export type MirrorTask = { stage_key: string; status: string }

// Какие order-level флаги пора проставить: этап считается закрытым, когда закрыты
// ВСЕ его позиционные задачи, а сам флаг ещё не стоит.
// Уже стоящий флаг не трогаем в любом виде: там может лежать ручная отметка
// менеджера или историческое `true` — перезапись стёрла бы её молча.
export function pickOrderStageFlags(
  tasks:   MirrorTask[],
  current: Record<string, unknown>,
  day:     string,
): Record<string, string> {
  const byStage: Record<string, string[]> = {}
  for (const t of tasks) (byStage[t.stage_key] ??= []).push(t.status)

  const patch: Record<string, string> = {}
  for (const [stage, statuses] of Object.entries(byStage)) {
    const flag = STAGE_TO_FLAG[stage]
    if (!flag) continue
    const allDone = statuses.length > 0 && statuses.every(s => s === 'done')
    if (allDone && !current[flag]) patch[flag] = day
  }
  return patch
}

// Возвращает проставленные флаги — вызывающая сторона может отличить «ничего не
// изменилось» от «заказ только что закрылся». На переходе `packaged` в волне V
// повиснет списание материала со склада (П19), и повесить его на «зеркало
// отработало» вместо «флаг сменился» означало бы звать склад на каждую отметку.
export async function mirrorOrderStages(
  svc: SupabaseClient,
  orderId: number,
): Promise<string[]> {
  const { data: tasks } = await svc
    .from('production_tasks')
    .select('stage_key,status')
    .eq('order_id', orderId)
  if (!tasks || tasks.length === 0) return []

  const { data: order } = await svc.from('b2b_orders').select('notes').eq('id', orderId).single()
  if (!order) return []
  const notes = typeof order.notes === 'string'
    ? (() => { try { return JSON.parse(order.notes) } catch { return {} } })()
    : (order.notes ?? {})
  const current = (notes.stages ?? {}) as Record<string, unknown>

  const patch = pickOrderStageFlags(tasks as MirrorTask[], current, new Date().toISOString().slice(0, 10))
  const flags = Object.keys(patch)
  if (flags.length === 0) return []

  const { error } = await svc.rpc('mark_order_stages', { p_order_id: orderId, p_stages: patch })
  if (error) return []
  return flags
}
