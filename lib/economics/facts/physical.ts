import { isProductItem, type StoredItem } from './items'

// Физический расход листа позиции по КАЖДОМУ стеклу. totalAreaBilled — площадь с расходом
// ОДНОГО стекла (costMaterial = billed × сумма цен слоёв), поэтому пакет из N стёкол забирает
// со склада N раз эту площадь, каждое — своим материалом. Смысл totalAreaBilled не меняется.
export type GlassUse = { layer: number; materialId: number | null; materialName: string | null; m2: number }

const num = (x: unknown) => (Number.isFinite(Number(x)) ? Number(x) : 0)

export function glassUse(it: StoredItem): GlassUse[] {
  const m2 = Math.round((num(it.totalAreaBilled ?? it.totalAreaNet)) * 10000) / 10000
  if (!(m2 > 0)) return []
  const extra = Array.isArray(it.triplexGlasses) ? it.triplexGlasses as StoredItem[] : []
  const layers = !isProductItem(it) && it.hasTriplex ? (num(it.triplexLayers) === 3 ? 3 : 2) : 1
  return Array.from({ length: layers }, (_, i) => {
    // Второе стекло не записано — пакет из одинаковых (так считает calcItem).
    const glass = i === 0 ? it : extra[i - 1] ?? it
    return {
      layer: i + 1,
      materialId: glass.materialId == null ? null : num(glass.materialId),
      materialName: glass.materialName == null ? null : String(glass.materialName),
      m2,
    }
  })
}
