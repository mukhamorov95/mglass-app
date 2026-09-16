import { calcFactoryMirror, ALL_SIDES, type FactoryData, type LightSides } from '../b2bFactoryProducts'
import { parseProductSpec, reconcile, type ProductBreakdown, type BreakdownLine } from './productBreakdown'

// Восстановление состава себестоимости зеркала по сохранённой позиции просчёта.
// Считает тот же калькулятор, что считал заказ; результат сверяется с суммой,
// сохранённой в позиции. Стороны подсветки в позицию не писались — перебираем
// разумные варианты и берём тот, который воспроизводит сохранённую сумму.

const SIDE_VARIANTS: LightSides[] = [
  ALL_SIDES,
  { top: true, bottom: true, left: false, right: false },
  { top: false, bottom: false, left: true, right: true },
  { top: true, bottom: false, left: false, right: false },
  { top: false, bottom: true, left: false, right: false },
]

export type SavedItem = {
  materialName?: unknown; comment?: unknown; thickness?: unknown
  width?: unknown; height?: unknown; quantity?: unknown
  costMaterial?: unknown; facetTypeMm?: unknown
  bom?: unknown
}

const n = (x: unknown) => Number(x) || 0
const short = (c: { name: string; short_name?: string | null }) => (c.short_name?.trim() || c.name).trim()

export function mirrorBreakdown(item: SavedItem, data: FactoryData): ProductBreakdown | null {
  const qty = Math.max(1, n(item.quantity))
  const stored = n(item.costMaterial)

  // Состав сохранён в просчёте (с 16.09) — берём как есть, ничего не пересчитываем.
  const saved = Array.isArray(item.bom) ? (item.bom as BreakdownLine[]) : []
  if (saved.length) return reconcile(saved, stored, 'saved')

  const spec = parseProductSpec(String(item.materialName ?? ''), item.comment as string | null, n(item.thickness))
  if (!spec || !(n(item.width) > 0) || !(n(item.height) > 0)) return null

  const byShort = (type: string, name: string | null) =>
    name ? data.components.find(c => c.component_type === type && short(c) === name) ?? null : null
  const led = byShort('led_strip', spec.ledShort)
  const frame = byShort('frame', spec.frameShort)

  let best: ProductBreakdown | null = null
  for (const sides of SIDE_VARIANTS) {
    const q = calcFactoryMirror({
      widthMm: n(item.width), heightMm: n(item.height),
      mirrorName: spec.mirrorName, mirrorMm: spec.mirrorMm,
      hasLighting: spec.hasLighting, buttonType: spec.buttonType, lightSides: sides,
      facetTypeMm: (item.facetTypeMm as number | null) ?? null,
      ledId: led?.id ?? null, frameId: frame?.id ?? null,
      curved: spec.curved, underlayCost: spec.underlayCost, metalFrame: spec.metalFrame,
    }, data)
    if (!q?.costLines?.length) continue
    const lines: BreakdownLine[] = q.costLines.map(l => ({
      name: l.name, unit: l.unit,
      qty: Math.round(l.qty * qty * 1000) / 1000,
      price: l.price,
      total: Math.round(l.total * qty),
    }))
    const r = reconcile(lines, stored, 'recalc')
    if (r.reconciles) return r
    if (!best) best = r
  }
  return best
}
