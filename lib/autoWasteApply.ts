// Мост между позициями калькулятора и авторасходом раскроя.
//
// Заменяет ручной waste_percent на автоматический процент, посчитанный из
// реального раскроя деталей заказа (lib/materialUsage). Процент — ОДИН на
// материал (все детали материала кроятся вместе), поэтому применяется ко всем
// позициям этого материала. Цена клиенту не меняется — только себестоимость и
// маржа (см. applyAutoWaste в b2bCalculator).

import type { B2BOrderItem } from './b2bCalculator'
import { applyAutoWaste } from './b2bCalculator'
import { autoWasteByMaterial, type UsageItem } from './materialUsage'

// Доля крупного остатка, возвращаемого на стеллаж. 0.85 проверено на 500+
// позициях июля: суммарный материал ≈ ручной (−1.4%, без шока по марже), но
// перераспределён по геометрии — неудобные одиночные детали дорожают, плотно
// раскладывающиеся дешевеют. Ровно то, что просил владелец.
export const CALC_REUSE_RATE = 0.85

type MatLike = {
  name: string
  thickness: number
  sheet_width?: number | null
  sheet_height?: number | null
  pattern_direction?: string | null
  passthrough?: boolean | null
}

/**
 * Вернуть позиции с себестоимостью и маржой по автоматическому расходу.
 * Геометрия, цена клиента, услуги и договорные цены — без изменений.
 */
export function applyAutoWasteToItems(items: B2BOrderItem[], materials: MatLike[]): B2BOrderItem[] {
  if (!items.length) return items
  const matLookup = new Map<string, MatLike>()
  for (const m of materials) matLookup.set(`${m.name}|${m.thickness}`, m)

  const usage: UsageItem[] = items
    .filter(it => it.width > 0 && it.height > 0 && it.quantity > 0 && it.totalAreaBilled > 0)
    // Изделия производства ('изделие') — своя ПОЛНАЯ себестоимость цеха
    // (стекло+фурнитура+работа+накладные+резерв брака 5%). Авто-расход раскроя
    // к ним неприменим: он раздул бы весь cost (включая труд/фурнитуру) на % обрези
    // и задвоил брак. Не нестим и не пересчитываем — см. .map ниже.
    .filter(it => it.category !== 'изделие')
    // «Проходной» материал — фиксированный расход по бизнес-правилу, не нестится.
    .filter(it => !matLookup.get(`${it.materialName}|${it.thickness}`)?.passthrough)
    .map(it => {
      const m = matLookup.get(`${it.materialName}|${it.thickness}`)
      return {
        materialName: it.materialName, thickness: it.thickness, category: it.category,
        width: it.width, height: it.height, quantity: it.quantity,
        costPerM2: it.costMaterial / it.totalAreaBilled,
        sheetWidth: m?.sheet_width ?? undefined, sheetHeight: m?.sheet_height ?? undefined,
        patternDirection: (m?.pattern_direction ?? 'none') as UsageItem['patternDirection'],
      }
    })
  if (!usage.length) return items

  const wasteMap = autoWasteByMaterial(usage, CALC_REUSE_RATE)
  return items.map(it => {
    if (it.category === 'изделие') return it   // изделие производства — себестоимость финальная
    const pct = wasteMap.get(`${it.materialName}|${it.thickness}`)
    return pct != null ? applyAutoWaste(it, pct) : it
  })
}
