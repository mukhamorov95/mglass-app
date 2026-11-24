import { readIn } from '@/lib/production/paged'
import { lineKeyOf } from '@/lib/production/clientShipments'

// Сколько штук заказа уже уехало: отгрузки по изделиям (delivery_shipment_items в
// отгрузках со статусом shipped) плюс «уехало раньше» из заметки заказа.
// Партнёру нужна одна строка «уехало 3 из 5 шт.», пока заказ не уехал целиком.

type Item = { localId?: string | null; quantity?: unknown }
export type ShipPartial = { shipped: number; total: number }

export const pieces = (it: Item) => Math.max(1, Math.floor(Number(it.quantity) || 1))

export function shipPartial(items: Item[], shippedOf: (lineKey: string) => number): ShipPartial | null {
  if (items.length === 0) return null
  let shipped = 0, total = 0
  items.forEach((it, i) => {
    const qty = pieces(it)
    total += qty
    shipped += Math.min(qty, Math.max(0, shippedOf(lineKeyOf(it, i))))
  })
  return shipped > 0 && shipped < total ? { shipped, total } : null
}

export function earlierLines(notes: Record<string, unknown>): Record<string, number> {
  const se = notes.shipped_earlier as { lines?: Record<string, unknown> } | null | undefined
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(se?.lines ?? {})) {
    const n = Number(v)
    if (n > 0) out[k] = n
  }
  return out
}

type Svc = { from: (t: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any
type Row = { order_id: number; line_key: string; qty: number; delivery_shipments: { status: string } | { status: string }[] | null }

// Ключ `${orderId}:${lineKey}` → отгружено штук.
export async function loadShippedLines(svc: Svc, orderIds: number[]): Promise<Map<string, number>> {
  const rows = await readIn<Row, number>(orderIds, (part, from, to) => svc.from('delivery_shipment_items')
    .select('order_id, line_key, qty, delivery_shipments!inner(status)')
    .in('order_id', part).eq('delivery_shipments.status', 'shipped').range(from, to))
  const out = new Map<string, number>()
  for (const r of rows) {
    const k = `${r.order_id}:${r.line_key}`
    out.set(k, (out.get(k) ?? 0) + (Number(r.qty) || 0))
  }
  return out
}
