import type { SupabaseClient } from '@supabase/supabase-js'
import { parseOrderNotes } from '@/lib/b2b/orderNotes'

// Точка на стройрынке — b2b_clients.is_point (решение владельца 01.10.2026,
// docs/partner-points/PARTNER_POINTS_ROUTE.md): заказы точки цех делает первыми,
// в работу они уходят только после 100 % оплаты. Отсрочки пока нет.

// Array.sort устойчив, поэтому внутри точек и внутри остальных сохраняется порядок,
// в котором экран уже их выстроил (срочность, срок отгрузки).
export function pointsFirst<T>(list: readonly T[], isPoint: (x: T) => boolean): T[] {
  const head: T[] = []
  const tail: T[] = []
  for (const x of list) (isPoint(x) ? head : tail).push(x)
  return [...head, ...tail]
}

// Для составной сортировки, где точки поднимаются только внутри своей группы.
export const pointRank = (isPoint: boolean): number => (isPoint ? 0 : 1)

// Ошибка чтения — пустой набор: пометка и порядок — подсказка цеху, очередь без них
// обязана открыться. Правило оплаты держится на сервере, а не на этом наборе.
export async function loadPointClientIds(sb: SupabaseClient): Promise<Set<number>> {
  const { data, error } = await sb.from('b2b_clients').select('id').eq('is_point', true)
  if (error) {
    console.error('[points] признак точки не прочитан:', error.message)
    return new Set()
  }
  return new Set((data ?? []).map(r => (r as { id: number }).id))
}

// Статусы, которые экраны менеджера показывают как «в работе» (lib/b2b/orderNotes.ts).
export const IN_WORK_STATUSES: readonly string[] = ['sent', 'confirmed', 'in_production']

export const orderTotal = (o: { total_after_discount?: number | null; total_sale_inc_vat?: number | null }): number =>
  Number(o.total_after_discount ?? o.total_sale_inc_vat ?? 0) || 0

const rub = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`

// Почему заказ точки нельзя пускать в работу; null — можно. «Оплачен» ставит только
// POST /api/b2b-orders/[id]/payment — единственный писатель оплаты.
export function pointPrepayRefusal(notes: unknown, total?: number | null): string | null {
  const n = parseOrderNotes(notes)
  if (n.payment_status === 'paid') return null
  const pre = Number(n.prepayment_amount) || 0
  const state = n.payment_status === 'partial' && pre > 0
    ? `Отмечена предоплата ${rub(pre)}${total && total > 0 ? ` из ${rub(total)}` : ''}.`
    : 'Оплата по заказу не отмечена.'
  return `Заказ точки уходит в работу только после 100 % оплаты. ${state} Когда деньги придут, отметьте «Оплачен» в колонке «Оплата» и запустите заказ снова.`
}

export type PointGate = { ok: true } | { ok: false; status: number; error: string }

// Серверная калитка запуска. Признак читается сервис-клиентом, чтобы RLS вызывающего
// не могла молча превратить точку в «не точку». Не прочитали — не пускаем.
export async function pointLaunchGate(
  svc: SupabaseClient,
  order: { client_id: number | null; notes: unknown; total?: number | null },
): Promise<PointGate> {
  if (order.client_id == null) return { ok: true }
  const { data, error } = await svc.from('b2b_clients').select('is_point').eq('id', order.client_id).maybeSingle()
  if (error) return { ok: false, status: 500, error: `Не удалось проверить, заказ ли это точки: ${error.message}. Попробуйте ещё раз` }
  if ((data as { is_point?: boolean } | null)?.is_point !== true) return { ok: true }
  const refusal = pointPrepayRefusal(order.notes, order.total)
  return refusal ? { ok: false, status: 409, error: refusal } : { ok: true }
}
