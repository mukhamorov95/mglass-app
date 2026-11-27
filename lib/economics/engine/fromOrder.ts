import { itemParts, isProductItem, type StoredItem } from '../facts/items'
import { bomOperation, serviceOperation } from '../facts/operations'
import type { PartSpec, Missing } from './technology'

// Технологическое описание сохранённой позиции. Чего в ней нет (тип кромки, разметка, режим
// пескоструя, тип выреза) — «неизвестно», а не предположение.
const num = (x: unknown) => (Number.isFinite(Number(x)) ? Number(x) : 0)
const arr = (x: unknown) => (Array.isArray(x) ? x as Record<string, unknown>[] : [])

export function itemSpecs(orderId: number, index: number, it: StoredItem, materialKey: (id: number | null) => string | null): PartSpec[] {
  const q = num(it.quantity), w = num(it.width) || null, h = num(it.height) || null
  const services = arr(it.services).map(s => ({ op: serviceOperation(String(s.name ?? '')), type: String(s.type ?? '') }))
  const bomOps = new Set(arr(it.bom).map(b => bomOperation(String(b.name ?? ''))))
  const product = isProductItem(it)
  const sand = !!it.hasSandblast || bomOps.has('sandblast') || services.some(s => s.op === 'sandblast')
  const base = {
    widthMm: w, heightMm: h, qty: q, marking: 'unknown' as const,
    sandblast: sand ? { m2PerPart: null, mode: 'unknown' as const } : null,
    packaging: true,
  }
  if (product) {
    return [{
      ...base, key: `${orderId}:${index}:1`, materialKey: materialKey(num(it.materialId) || null),
      thicknessMm: num(it.thickness) || 4, shape: 'rect', edge: 'unknown', holes: [], cutouts: [], tempering: false,
      frame: { welding: bomOps.has('frame_welding'), assembly: bomOps.has('assembly') },
    }]
  }
  const parts = itemParts(orderId, index, it)
  const first = parts[0]
  const curved = it.shape === 'curved'
  return [{
    ...base, key: first.partKey, materialKey: materialKey(first.materialId), thicknessMm: first.thicknessMm,
    layers: parts.length, shape: curved ? 'curved' : 'rect',
    edge: curved || num(it.costEdge) > 0 ? 'unknown' : 'none',
    holes: first.holes.filter(x => x.qty).map(x => ({ diameterMm: x.diameterMm, perPart: x.qty! })),
    holesUncounted: !!it.hasHoles && !first.holes.some(x => x.qty),
    cutouts: first.cutouts.filter(x => x.qty).map(x => ({ type: null, perPart: x.qty! })),
    cutoutsUncounted: first.cutouts.some(x => x.qty == null),
    tempering: num(it.costTempering) > 0,
  }]
}

