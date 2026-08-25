import { createServiceClient } from '@/lib/supabase-service'
import type {
  InventoryItem, InventoryMove, Kind, Unit, Contour, MoveReason, MoveOrigin, RefTable, DocType, ConsumePlan, PlanRow,
} from './types'
import { sheetArea, INCOMING } from './units'
import { normalizeUnit } from './match'
import { planB2BOrder, planBomLines, type MatchTarget, type B2BItemLike, type BomLike } from './plan'
import type { InventoryActor } from './auth'
import { markReservationConsumed, listReservations } from './reserve'

const svc = () => createServiceClient()

const ITEM_COLS =
  'id, contour, kind, name, article, unit, pack_label, pack_size, ref_table, ref_id, supplier_id, ' +
  'color, thickness, location, min_qty, target_qty, qty, qty_reserved, avg_cost, bom_aliases, active, ' +
  'notes, created_at, updated_at'

// ─── Чтение ──────────────────────────────────────────────────────────────────

export async function listItems(opts: {
  contour?: Contour | 'all'
  kind?:    Kind | 'all'
  search?:  string
  onlyDeficit?: boolean
  includeInactive?: boolean
} = {}): Promise<InventoryItem[]> {
  let q = svc().from('inventory_items').select(ITEM_COLS)
  if (!opts.includeInactive) q = q.eq('active', true)
  if (opts.contour && opts.contour !== 'all') q = q.in('contour', [opts.contour, 'both'])
  if (opts.kind    && opts.kind    !== 'all') q = q.eq('kind', opts.kind)
  if (opts.search) q = q.or(`name.ilike.%${opts.search}%,article.ilike.%${opts.search}%`)

  const { data, error } = await q.order('kind').order('name')
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as unknown as InventoryItem[]
  return opts.onlyDeficit
    ? rows.filter(r => (r.min_qty > 0 && r.qty <= r.min_qty) || (r.target_qty > 0 && r.qty < r.target_qty))
    : rows
}

export async function matchTargets(): Promise<MatchTarget[]> {
  const { data, error } = await svc()
    .from('inventory_items')
    .select('id, name, unit, qty, ref_table, ref_id, bom_aliases')
    .eq('active', true)
  if (error) throw new Error(error.message)
  return (data ?? []) as MatchTarget[]
}

export type MoveRow = InventoryMove & { item_name: string; item_unit: Unit }

export async function listMoves(opts: { itemId?: number; limit?: number; reason?: MoveReason } = {}): Promise<MoveRow[]> {
  let q = svc()
    .from('inventory_moves')
    .select('id, item_id, qty, pack_qty, reason, origin, unit_cost, doc_type, doc_id, note, created_by, created_by_name, created_at, inventory_items(name, unit)')
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 200)
  if (opts.itemId) q = q.eq('item_id', opts.itemId)
  if (opts.reason) q = q.eq('reason', opts.reason)

  const { data, error } = await q
  if (error) throw new Error(error.message)

  type Joined = InventoryMove & { inventory_items: { name: string; unit: Unit } | null }
  return ((data ?? []) as unknown as Joined[]).map(m => ({
    ...m,
    item_name: m.inventory_items?.name ?? '—',
    item_unit: m.inventory_items?.unit ?? 'шт',
  }))
}

export async function summary() {
  const items = await listItems({ includeInactive: false })
  const byContour = (c: Contour) => items.filter(i => i.contour === c || i.contour === 'both')

  const value = (list: InventoryItem[]) =>
    Math.round(list.reduce((s, i) => s + Math.max(0, i.qty) * i.avg_cost, 0))

  const deficit = items.filter(i => i.min_qty > 0 && i.qty <= i.min_qty)
  const zero    = items.filter(i => i.qty <= 0 && (i.min_qty > 0 || i.target_qty > 0))

  return {
    items:      items.length,
    b2b:        { items: byContour('b2b').length, value: value(byContour('b2b')) },
    b2c:        { items: byContour('b2c').length, value: value(byContour('b2c')) },
    totalValue: value(items),
    deficit:    deficit.length,
    zero:       zero.length,
    noCost:     items.filter(i => i.qty > 0 && i.avg_cost <= 0).length,
    untouched:  items.filter(i => i.qty === 0 && i.min_qty === 0 && i.target_qty === 0).length,
  }
}

// ─── Карточки ────────────────────────────────────────────────────────────────

export type ItemInput = Partial<Omit<InventoryItem, 'id' | 'qty' | 'avg_cost' | 'created_at' | 'updated_at'>>

export async function createItem(input: ItemInput): Promise<InventoryItem> {
  if (!input.name?.trim()) throw new Error('Нужно название')
  const { data, error } = await svc().from('inventory_items').insert({
    ...input,
    name: input.name.trim(),
  }).select(ITEM_COLS).single()
  if (error) throw new Error(error.message)
  return data as unknown as InventoryItem
}

// Остаток правится только движениями — руками сюда не пускаем.
const PROTECTED = new Set(['id', 'qty', 'avg_cost', 'created_at', 'updated_at'])

export async function updateItem(id: number, input: ItemInput): Promise<InventoryItem> {
  const patch: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) if (!PROTECTED.has(k)) patch[k] = v
  patch.updated_at = new Date().toISOString()

  const { data, error } = await svc().from('inventory_items').update(patch).eq('id', id).select(ITEM_COLS).single()
  if (error) throw new Error(error.message)
  return data as unknown as InventoryItem
}

// ─── Движения ────────────────────────────────────────────────────────────────

export type NewMove = {
  item_id:   number
  qty:       number          // со знаком, в базовой единице
  pack_qty?: number | null
  reason:    MoveReason
  origin?:   MoveOrigin
  unit_cost?: number
  doc_type?: DocType | null
  doc_id?:   string | null
  note?:     string
}

export async function addMoves(rows: NewMove[], actor: InventoryActor): Promise<{ inserted: number; skipped: number }> {
  const clean = rows.filter(r => r.item_id && Number(r.qty) !== 0)
  if (!clean.length) return { inserted: 0, skipped: rows.length }

  const payload = clean.map(r => ({
    item_id:   r.item_id,
    qty:       Number(r.qty),
    pack_qty:  r.pack_qty ?? null,
    reason:    r.reason,
    origin:    r.origin ?? 'fact',
    unit_cost: Math.max(0, Number(r.unit_cost ?? 0)),
    doc_type:  r.doc_type ?? null,
    doc_id:    r.doc_id ?? null,
    note:      r.note ?? '',
    created_by:      actor.userId,
    created_by_name: actor.name,
  }))

  // Повтор по документу отсекает уникальный индекс — считаем это «уже списано»,
  // а не ошибкой: кнопку могли нажать дважды.
  const { data, error } = await svc().from('inventory_moves').insert(payload).select('id')
  if (error) {
    if (error.code === '23505') return { inserted: 0, skipped: clean.length }
    throw new Error(error.message)
  }
  return { inserted: data?.length ?? 0, skipped: rows.length - clean.length }
}

// Инвентаризация: вводим ФАКТ, система сама пишет разницу движением.
export async function applyCount(
  rows: { item_id: number; actual: number; note?: string }[], actor: InventoryActor,
): Promise<{ adjusted: number; unchanged: number }> {
  const ids = rows.map(r => r.item_id)
  if (!ids.length) return { adjusted: 0, unchanged: 0 }

  const { data, error } = await svc().from('inventory_items').select('id, qty').in('id', ids)
  if (error) throw new Error(error.message)
  const current = new Map((data ?? []).map(r => [r.id as number, Number(r.qty)]))

  const moves: NewMove[] = []
  let unchanged = 0
  for (const r of rows) {
    const now  = current.get(r.item_id)
    if (now === undefined) continue
    const diff = Math.round((Number(r.actual) - now) * 10000) / 10000
    if (diff === 0) { unchanged++; continue }
    moves.push({
      item_id: r.item_id, qty: diff, reason: 'count',
      note: r.note ?? `Инвентаризация: было ${now}, стало ${r.actual}`,
    })
  }
  const res = await addMoves(moves, actor)
  return { adjusted: res.inserted, unchanged }
}

export const isIncoming = (reason: MoveReason) => INCOMING.includes(reason)

// ─── Заведение карточек из существующих справочников ─────────────────────────

export type CatalogCandidate = {
  ref_table: RefTable
  ref_id:    string
  name:      string
  article:   string
  kind:      Kind
  contour:   Contour
  unit:      Unit
  pack_label: string | null
  pack_size:  number
  thickness:  number | null
  supplier_id: string | null
  imported:   boolean
}

function b2bKind(category: string | null): Kind {
  return (category ?? '').toLowerCase().includes('зеркал') ? 'mirror' : 'glass'
}

function showerKind(category: string | null): Kind {
  const c = (category ?? '').toLowerCase()
  if (c.includes('профил') || c.includes('штанг')) return 'profile'
  if (c.includes('уплотнител'))                    return 'seal'
  return 'hardware'
}

function materialKind(category: string | null): Kind {
  const c = (category ?? '').toLowerCase()
  if (c.includes('зеркал'))    return 'mirror'
  if (c.includes('стекл'))     return 'glass'
  if (c.includes('подсветк') || c.includes('электрик')) return 'led'
  if (c.includes('профил'))    return 'profile'
  if (c.includes('фурнитур'))  return 'hardware'
  if (c.includes('расходник')) return 'consumable'
  return 'other'
}

export async function catalogCandidates(): Promise<CatalogCandidate[]> {
  const db = svc()
  const [b2b, shower, mats, existing] = await Promise.all([
    db.from('b2b_materials').select('id, name, category, thickness, sheet_width, sheet_height, supplier_id, active').eq('active', true),
    db.from('shower_catalog_items').select('id, name, article, category, unit, whip_length, active').eq('active', true),
    db.from('materials').select('id, name, category, unit, active').eq('active', true),
    db.from('inventory_items').select('ref_table, ref_id').not('ref_table', 'is', null),
  ])

  const taken = new Set((existing.data ?? []).map(r => `${r.ref_table}:${r.ref_id}`))
  const out: CatalogCandidate[] = []

  type B2BRow = { id: number; name: string; category: string | null; thickness: number | null; sheet_width: number | null; sheet_height: number | null; supplier_id: string | null }
  for (const m of (b2b.data ?? []) as B2BRow[]) {
    out.push({
      ref_table: 'b2b_materials', ref_id: String(m.id),
      name: m.thickness ? `${m.name} ${m.thickness} мм` : m.name,
      article: '', kind: b2bKind(m.category), contour: 'b2b', unit: 'м2',
      pack_label: 'лист', pack_size: sheetArea(m.sheet_width ?? 3210, m.sheet_height ?? 2250),
      thickness: m.thickness, supplier_id: m.supplier_id,
      imported: taken.has(`b2b_materials:${m.id}`),
    })
  }

  type ShowerRow = { id: number; name: string; article: string | null; category: string | null; unit: string | null; whip_length: number | null }
  for (const s of (shower.data ?? []) as ShowerRow[]) {
    const whip = s.whip_length && s.whip_length > 0 ? s.whip_length / 1000 : 0
    const isWhip = (s.unit ?? '').toLowerCase() === 'хлыст' || whip > 0
    out.push({
      ref_table: 'shower_catalog_items', ref_id: String(s.id),
      name: s.article ? `${s.name} (${s.article})` : s.name,
      article: s.article ?? '',
      kind: showerKind(s.category), contour: 'b2c',
      unit: isWhip ? 'м.п.' : (normalizeUnit(s.unit) ?? 'шт'),
      pack_label: isWhip ? 'хлыст' : null, pack_size: isWhip ? whip : 0,
      thickness: null, supplier_id: null,
      imported: taken.has(`shower_catalog_items:${s.id}`),
    })
  }

  type MatRow = { id: number; name: string; category: string | null; unit: string | null }
  for (const m of (mats.data ?? []) as MatRow[]) {
    out.push({
      ref_table: 'materials', ref_id: String(m.id),
      name: m.name, article: '', kind: materialKind(m.category), contour: 'b2c',
      unit: normalizeUnit(m.unit) ?? 'шт', pack_label: null, pack_size: 0,
      thickness: null, supplier_id: null,
      imported: taken.has(`materials:${m.id}`),
    })
  }

  return out
}

export async function importFromCatalog(refs: { ref_table: RefTable; ref_id: string }[]): Promise<number> {
  const all  = await catalogCandidates()
  const want = new Set(refs.map(r => `${r.ref_table}:${r.ref_id}`))
  const rows = all.filter(c => want.has(`${c.ref_table}:${c.ref_id}`) && !c.imported)
  if (!rows.length) return 0

  const { data, error } = await svc().from('inventory_items').insert(rows.map(c => ({
    contour: c.contour, kind: c.kind, name: c.name, article: c.article, unit: c.unit,
    pack_label: c.pack_label, pack_size: c.pack_size, ref_table: c.ref_table, ref_id: c.ref_id,
    thickness: c.thickness, supplier_id: c.supplier_id,
  }))).select('id')
  if (error) throw new Error(error.message)
  return data?.length ?? 0
}

// ─── Списание по документу ───────────────────────────────────────────────────

async function alreadyConsumed(docType: DocType, docId: string): Promise<boolean> {
  const { data } = await svc().from('inventory_moves')
    .select('id').eq('doc_type', docType).eq('doc_id', docId).in('reason', ['order', 'production']).limit(1)
  return !!(data && data.length)
}

// Резерв под заказ (active) — дефолт количества для списания по факту в цехе.
async function reservedByItem(docType: DocType, docId: string): Promise<Map<number, number>> {
  const active = (await listReservations(docType, docId)).filter(r => r.status === 'active')
  const map = new Map<number, number>()
  for (const r of active) map.set(r.item_id, (map.get(r.item_id) ?? 0) + Number(r.qty))
  return map
}

export function attachReserved(rows: PlanRow[], reserved: Map<number, number>): PlanRow[] {
  return rows.map(r => r.item_id !== null && reserved.has(r.item_id)
    ? { ...r, reserved: reserved.get(r.item_id) }
    : r)
}

export async function buildConsumePlan(docType: DocType, docId: string): Promise<ConsumePlan> {
  const db    = svc()
  const stock = await matchTargets()
  const reserved = await reservedByItem(docType, docId)

  if (docType === 'b2b_order') {
    const { data, error } = await db.from('b2b_orders')
      .select('id, custom_number, client_name, items').eq('id', Number(docId)).single()
    if (error) throw new Error(error.message)
    const items = ((data?.items as { items?: B2BItemLike[] } | B2BItemLike[] | null) ?? []) as B2BItemLike[] | { items?: B2BItemLike[] }
    const list  = Array.isArray(items) ? items : (items.items ?? [])
    return {
      doc_type: 'b2b_order', doc_id: docId,
      title:   `B2B-заказ ${data?.custom_number ?? data?.id} · ${data?.client_name ?? ''}`.trim(),
      rows:    attachReserved(planB2BOrder(list, stock), reserved),
      already: await alreadyConsumed('b2b_order', docId),
    }
  }

  if (docType === 'order') {
    const { data, error } = await db.from('orders')
      .select('id, number, client_name, order_lines(materials_bom, hardware_bom)').eq('id', docId).single()
    if (error) throw new Error(error.message)
    type Line = { materials_bom: BomLike[] | null; hardware_bom: BomLike[] | null }
    const lines = ((data?.order_lines ?? []) as Line[])
      .flatMap(l => [...(l.materials_bom ?? []), ...(l.hardware_bom ?? [])])
    return {
      doc_type: 'order', doc_id: docId,
      title:   `Заказ ${data?.number ?? ''} · ${data?.client_name ?? ''}`.trim(),
      rows:    attachReserved(planBomLines(lines, stock), reserved),
      already: await alreadyConsumed('order', docId),
    }
  }

  throw new Error(`Списание по документу «${docType}» не поддерживается`)
}

export async function applyConsume(
  plan: ConsumePlan, actor: InventoryActor, rows?: PlanRow[], origin: MoveOrigin = 'fact',
): Promise<{ inserted: number; skipped: number; released: number }> {
  const use = (rows ?? plan.rows).filter(r => r.item_id !== null && r.qty > 0)

  // Порядок важен: СНАЧАЛА списываем со склада, ПОТОМ закрываем резерв. Если
  // упасть между — лучше «резерв ещё висит при списанном остатке» (видно и
  // чинится), чем «резерв закрыт, а материал не списан» (тихая недостача).
  const res = await addMoves(use.map(r => ({
    item_id: r.item_id as number,
    qty:     -Math.abs(r.qty),
    reason:  'order' as MoveReason,
    origin,
    doc_type: plan.doc_type,
    doc_id:   plan.doc_id,
    note:     plan.title,
  })), actor)

  // Заказ закрыт по факту: остаток активных резервов (в т.ч. неиспользованный
  // при частичном расходе) → consumed, поэтому лишнее возвращается в доступное.
  let released = 0
  if ((plan.doc_type === 'b2b_order' || plan.doc_type === 'order') && res.inserted > 0) {
    released = await markReservationConsumed(plan.doc_type, plan.doc_id).catch(() => 0)
  }
  return { ...res, released }
}
