import { createServiceClient } from '@/lib/supabase-service'
import type {
  ReserveResult, ReservedRow, ShortageRow, DocType, PlanRow, InventoryReservation, Unit,
} from './types'
import { planB2BOrder, planBomLines, type B2BItemLike, type BomLike, type MatchTarget } from './plan'

const svc = () => createServiceClient()
const round = (n: number) => Math.round(n * 10000) / 10000

async function stockTargets(): Promise<MatchTarget[]> {
  const { data, error } = await svc()
    .from('inventory_items')
    .select('id, name, unit, qty, qty_reserved, ref_table, ref_id, bom_aliases')
    .eq('active', true)
  if (error) throw new Error(error.message)
  return (data ?? []) as MatchTarget[]
}

// Доступное = остаток − уже зарезервированное. Резервируем ВСЮ потребность,
// нехватку выносим в shortages (best-effort: заказ не блокируется).
export function splitPlan(
  rows: PlanRow[],
  availableById: Map<number, { name: string; unit: Unit; available: number }>,
): { reserved: ReservedRow[]; shortages: ShortageRow[] } {
  const reserved:  ReservedRow[] = []
  const shortages: ShortageRow[] = []

  for (const r of rows) {
    if (r.item_id === null) {
      shortages.push({
        item_id: null, name: r.name, unit: r.unit, need: r.qty,
        available: 0, short: r.qty, reason: 'not_in_stock', source: r.source,
      })
      continue
    }
    const meta = availableById.get(r.item_id)
    const available = meta?.available ?? 0
    reserved.push({
      item_id: r.item_id, name: r.name, unit: meta?.unit ?? r.unit ?? 'шт',
      reserved: r.qty, available, source: r.source,
    })
    if (r.qty > available) {
      shortages.push({
        item_id: r.item_id, name: r.name, unit: r.unit, need: r.qty,
        available, short: round(r.qty - available),
        reason: 'insufficient', source: r.source,
      })
    }
  }
  return { reserved, shortages }
}

// Идемпотентный резерв под запущенный заказ. Best-effort: если позиции нет в
// номенклатуре или её не хватает — это shortage, а не ошибка. Повторный запуск
// того же заказа ничего не удваивает (alreadyReserved=true).
export async function reserveForOrder(
  docType: DocType,
  docId: string,
  items: B2BItemLike[] | BomLike[],
  actor?: { userId?: string; name?: string },
): Promise<ReserveResult> {
  if (docType !== 'b2b_order' && docType !== 'order') {
    throw new Error(`Резерв по документу «${docType}» не поддерживается`)
  }
  const db    = svc()
  const stock = await stockTargets()

  const rows: PlanRow[] = docType === 'b2b_order'
    ? planB2BOrder(items as B2BItemLike[], stock)
    : planBomLines(items as BomLike[], stock)

  // qty_reserved с карточек — вычитаем из остатка, получаем доступное.
  type StockRow = MatchTarget & { qty_reserved?: number }
  const availableById = new Map<number, { name: string; unit: Unit; available: number }>()
  for (const s of stock as StockRow[]) {
    availableById.set(s.id, { name: s.name, unit: s.unit, available: round(s.qty - (s.qty_reserved ?? 0)) })
  }

  // Уже есть активный резерв по этому заказу — не создаём повторно.
  const { data: existing } = await db
    .from('inventory_reservations')
    .select('id')
    .eq('doc_type', docType).eq('doc_id', docId).eq('status', 'active')
    .limit(1)

  const split = splitPlan(rows, availableById)

  if (existing && existing.length) {
    return { ...split, alreadyReserved: true }
  }

  const toInsert = rows.filter(r => r.item_id !== null && r.qty > 0)
  if (toInsert.length) {
    const { error } = await db.from('inventory_reservations').insert(toInsert.map(r => ({
      item_id:  r.item_id as number,
      qty:      Math.abs(r.qty),
      doc_type: docType,
      doc_id:   docId,
      note:     `Резерв под запуск заказа`,
      created_by:      actor?.userId ?? null,
      created_by_name: actor?.name ?? '',
    })))
    // Гонка двух запусков: уникальный индекс отобьёт дубль — это alreadyReserved.
    if (error && error.code === '23505') return { ...split, alreadyReserved: true }
    if (error) throw new Error(error.message)
  }

  return { ...split, alreadyReserved: false }
}

// Снять резерв заказа (отмена запуска / перепросчёт). Возврат склада не нужен —
// резерв склад не уменьшал.
export async function releaseReservation(docType: DocType, docId: string): Promise<number> {
  const { data, error } = await svc()
    .from('inventory_reservations')
    .update({ status: 'released', released_at: new Date().toISOString() })
    .eq('doc_type', docType).eq('doc_id', docId).eq('status', 'active')
    .select('id')
  if (error) throw new Error(error.message)
  return data?.length ?? 0
}

// Резерв заказа перешёл в фактический расход (материал забрали в цех): помечаем
// consumed. Списание пишется отдельно через applyConsume — здесь только резерв.
export async function markReservationConsumed(docType: DocType, docId: string): Promise<number> {
  const { data, error } = await svc()
    .from('inventory_reservations')
    .update({ status: 'consumed', released_at: new Date().toISOString() })
    .eq('doc_type', docType).eq('doc_id', docId).eq('status', 'active')
    .select('id')
  if (error) throw new Error(error.message)
  return data?.length ?? 0
}

export async function listReservations(docType: DocType, docId: string): Promise<InventoryReservation[]> {
  const { data, error } = await svc()
    .from('inventory_reservations')
    .select('id, item_id, qty, status, doc_type, doc_id, note, created_at, released_at')
    .eq('doc_type', docType).eq('doc_id', docId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as InventoryReservation[]
}
