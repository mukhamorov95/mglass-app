import type { PlanRow, Unit } from './types'
import { normalizeName, normalizeUnit, isServiceLine } from './match'

// Что нужно от складской карточки, чтобы сопоставить её со строкой документа.
export type MatchTarget = {
  id:          number
  name:        string
  unit:        Unit
  qty:         number
  ref_table:   string | null
  ref_id:      string | null
  bom_aliases: string[]
}

// Позиция B2B-заказа (b2b_orders.items): totalAreaBilled — уже м² с учётом
// количества и раскроя, ровно столько стекла уходит со склада.
export type B2BItemLike = {
  materialId?:      number | null
  materialName?:    string | null
  totalAreaBilled?: number | null
  totalAreaNet?:    number | null
  quantity?:        number | null
}

export type BomLike = { name: string; qty: number; unit?: string | null }

const round = (n: number) => Math.round(n * 10000) / 10000

function findByRef(stock: MatchTarget[], table: string, id: string | number): MatchTarget | undefined {
  return stock.find(s => s.ref_table === table && s.ref_id === String(id))
}

function findByNameOrAlias(stock: MatchTarget[], name: string): { item: MatchTarget; how: 'alias' | 'name' } | null {
  const n = normalizeName(name)
  if (!n) return null
  const byAlias = stock.find(s => s.bom_aliases.some(a => normalizeName(a) === n))
  if (byAlias) return { item: byAlias, how: 'alias' }
  const byName = stock.find(s => normalizeName(s.name) === n)
  if (byName) return { item: byName, how: 'name' }
  return null
}

// B2B: группируем по материалу — один лист стекла режется на несколько позиций.
export function planB2BOrder(items: B2BItemLike[], stock: MatchTarget[]): PlanRow[] {
  const byMaterial = new Map<string, { name: string; area: number; materialId: number | null }>()

  for (const it of items ?? []) {
    const area = Number(it.totalAreaBilled ?? it.totalAreaNet ?? 0)
    if (!(area > 0)) continue
    const key  = it.materialId != null ? `id:${it.materialId}` : `name:${normalizeName(it.materialName ?? '')}`
    const prev = byMaterial.get(key)
    if (prev) prev.area = round(prev.area + area)
    else byMaterial.set(key, {
      name:       it.materialName ?? `Материал #${it.materialId ?? '?'}`,
      area:       round(area),
      materialId: it.materialId ?? null,
    })
  }

  const rows: PlanRow[] = []
  for (const m of byMaterial.values()) {
    const byRef = m.materialId != null ? findByRef(stock, 'b2b_materials', m.materialId) : undefined
    if (byRef) {
      rows.push({ item_id: byRef.id, name: byRef.name, unit: byRef.unit, qty: m.area, available: byRef.qty, matched: 'ref', source: m.name })
      continue
    }
    const hit = findByNameOrAlias(stock, m.name)
    rows.push(hit
      ? { item_id: hit.item.id, name: hit.item.name, unit: hit.item.unit, qty: m.area, available: hit.item.qty, matched: hit.how, source: m.name }
      : { item_id: null, name: m.name, unit: 'м2', qty: m.area, available: 0, matched: 'none', source: m.name })
  }
  return rows
}

// B2C: состав заказа лежит в order_lines.materials_bom / hardware_bom построчно.
export function planBomLines(lines: BomLike[], stock: MatchTarget[]): PlanRow[] {
  const acc = new Map<string, PlanRow>()

  for (const l of lines ?? []) {
    const qty = Number(l.qty ?? 0)
    if (!(qty > 0) || !l.name) continue
    if (isServiceLine(l.name)) continue

    const hit  = findByNameOrAlias(stock, l.name)
    const key  = hit ? `i:${hit.item.id}` : `n:${normalizeName(l.name)}`
    const prev = acc.get(key)
    if (prev) { prev.qty = round(prev.qty + qty); continue }

    acc.set(key, hit
      ? { item_id: hit.item.id, name: hit.item.name, unit: hit.item.unit, qty: round(qty), available: hit.item.qty, matched: hit.how, source: l.name }
      : { item_id: null, name: l.name, unit: normalizeUnit(l.unit), qty: round(qty), available: 0, matched: 'none', source: l.name })
  }
  return [...acc.values()]
}

// Хватает ли склада на план — то, что менеджер спрашивает до запуска заказа.
export function planShortages(rows: PlanRow[]): PlanRow[] {
  return rows.filter(r => r.item_id === null || r.qty > r.available)
}
