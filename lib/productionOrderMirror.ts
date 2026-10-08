import type { SupabaseClient } from '@supabase/supabase-js'
import { notifyOrderManager } from '@/lib/b2b/notifyManager'
import { packagedNotice, orderLink } from '@/lib/production/managerNotices'

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
//
// На переходе `packaged` менеджеру уходит личное сообщение «упакован — согласуйте
// отгрузку» (маршрут «Порядок по всей системе», этап 2): до этого он узнавал об упаковке
// случайно, и заказы лежали упакованными неделями. Ровно один раз на переход — флаг
// ставит mark_order_stages_forward, который отвечает, какие ключи поставил именно этот
// вызов (две быстрые отметки цеха по одному заказу иначе обе «закрыли бы» заказ).
// Сбой отправки отметку цеха не роняет.
export async function mirrorOrderStages(
  svc: SupabaseClient,
  orderId: number,
): Promise<string[]> {
  const { data: tasks } = await svc
    .from('production_tasks')
    .select('stage_key,status')
    .eq('order_id', orderId)
  if (!tasks || tasks.length === 0) return []

  const { data: order } = await svc.from('b2b_orders').select('notes, custom_number, client_name').eq('id', orderId).single()
  if (!order) return []
  const notes = typeof order.notes === 'string'
    ? (() => { try { return JSON.parse(order.notes) } catch { return {} } })()
    : (order.notes ?? {})
  const current = (notes.stages ?? {}) as Record<string, unknown>

  const patch = pickOrderStageFlags(tasks as MirrorTask[], current, new Date().toISOString().slice(0, 10))
  if (Object.keys(patch).length === 0) return []

  const flags = await markForward(svc, orderId, patch)

  if (flags.includes('packaged')) {
    try {
      await notifyOrderManager(orderId, packagedNotice({ id: orderId, custom_number: order.custom_number, client_name: order.client_name }), orderLink(orderId))
    } catch { /* уведомление — побочный эффект, отметка цеха уже записана */ }
  }
  return flags
}

// Запись «только вперёд». Пока миграция 20261008_mark_order_stages_forward не применена —
// как раньше: безусловная mark_order_stages, а поставленными считаем свой расчёт (тогда
// «ровно один раз» держится на том, что две отметки по заказу редко совпадают до секунды).
async function markForward(svc: SupabaseClient, orderId: number, patch: Record<string, string>): Promise<string[]> {
  const { data, error } = await svc.rpc('mark_order_stages_forward', { p_order_id: orderId, p_stages: patch })
  if (!error) return Array.isArray(data) ? data.filter((k): k is string => typeof k === 'string') : []
  if (!isMissingFunction(error)) return []
  const { error: legacyErr } = await svc.rpc('mark_order_stages', { p_order_id: orderId, p_stages: patch })
  return legacyErr ? [] : Object.keys(patch)
}

// 42883 — функции нет в базе, PGRST202 — её нет в кэше схемы PostgREST.
export function isMissingFunction(error: { code?: string | null; message?: string | null }): boolean {
  return error.code === '42883' || error.code === 'PGRST202' || /could not find the function/i.test(error.message ?? '')
}
