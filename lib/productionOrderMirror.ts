import type { SupabaseClient } from '@supabase/supabase-js'

// Третье зеркало: когда все позиционные задачи этапа (production_tasks) закрыты,
// проставляем order-level флаг notes.stages, который читают /b2b-orders и Сводка.
// Ключи флагов — как в /b2b-orders (STAGES): cut / edge_processed / drilled /
// tempering / packaged. Только ПРОДВИГАЕМ статус (ставим done), никогда не
// снимаем — чтобы не затирать ручные отметки в /b2b-orders.

const STAGE_TO_FLAG: Record<string, string> = {
  cutting: 'cut',
  polishing: 'edge_processed',
  drilling: 'drilled',
  tempering: 'tempering',
  packaging: 'packaged',
  // curved — нет order-level эквивалента, пропускаем
}

export async function mirrorOrderStages(svc: SupabaseClient, orderId: number): Promise<void> {
  const { data: tasks } = await svc
    .from('production_tasks')
    .select('stage_key,status')
    .eq('order_id', orderId)
  if (!tasks || tasks.length === 0) return

  const byStage: Record<string, string[]> = {}
  for (const t of tasks as { stage_key: string; status: string }[]) {
    ;(byStage[t.stage_key] ??= []).push(t.status)
  }

  const { data: order } = await svc.from('b2b_orders').select('notes').eq('id', orderId).single()
  if (!order) return
  const notes = typeof order.notes === 'string'
    ? (() => { try { return JSON.parse(order.notes) } catch { return {} } })()
    : (order.notes ?? {})
  const stages: Record<string, unknown> = notes.stages ?? {}

  let changed = false
  const now = new Date().toISOString()
  for (const [stage, statuses] of Object.entries(byStage)) {
    const flag = STAGE_TO_FLAG[stage]
    if (!flag) continue
    const allDone = statuses.length > 0 && statuses.every(s => s === 'done')
    if (allDone && !stages[flag]) { stages[flag] = now; changed = true }
  }

  if (changed) {
    notes.stages = stages
    await svc.from('b2b_orders').update({ notes: JSON.stringify(notes) }).eq('id', orderId)
  }
}
