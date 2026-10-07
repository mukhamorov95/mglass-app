import type { SupabaseClient } from '@supabase/supabase-js'
import { parseNotes } from './publicQuote'
import { notesForCopy } from './orderNotes'

// Копия просчёта как черновик (У5). Жила внутри экрана просчётов; карточка заказа
// должна уметь то же самое, а два одинаковых insert'а разъезжаются — поэтому одна
// функция. Следы жизни исходного заказа (ссылка клиента, согласование, этапы,
// оплата, история) не переносятся — это делает notesForCopy.

export type DuplicableOrder = {
  client_id: number | null
  client_name: string
  discount_percent: number
  margin_percent: number
  items: unknown
  total_area: number
  total_weight: number
  total_cost_net: number | null
  total_cost_vat?: number | null
  total_sale_inc_vat: number
  total_after_discount: number
  notes: string | null
}

export async function duplicateOrder(
  sb: SupabaseClient,
  order: DuplicableOrder,
  opts: { managerName?: string | null; repeatedFrom?: number } = {},
): Promise<{ data: Record<string, unknown> | null; error: string | null }> {
  const { data: { user } } = await sb.auth.getUser()
  const copy = notesForCopy(parseNotes(order.notes), {
    at: new Date().toISOString(),
    managerName: opts.managerName ?? null,
  })
  // «Повторить» из списка заказов — тот же черновик, но с пометкой источника: по ней
  // считается, пользуются ли повтором (/api/admin/adoption).
  if (opts.repeatedFrom != null) copy.repeated_from = opts.repeatedFrom
  const notes = JSON.stringify(copy)
  const { data, error } = await sb.from('b2b_orders').insert({
    client_id: order.client_id, client_name: order.client_name,
    discount_percent: order.discount_percent, margin_percent: order.margin_percent,
    items: order.items, total_area: order.total_area, total_weight: order.total_weight,
    total_cost_net: order.total_cost_net ?? 0, total_cost_vat: order.total_cost_vat ?? 0,
    total_sale_inc_vat: order.total_sale_inc_vat, total_after_discount: order.total_after_discount,
    notes,
    created_by: user?.id ?? null,
    created_by_name: opts.managerName ?? null,
  }).select().single()
  if (error) return { data: null, error: error.message }
  if (!data) return { data: null, error: 'Сервер не вернул новую запись' }
  return { data: data as Record<string, unknown>, error: null }
}
