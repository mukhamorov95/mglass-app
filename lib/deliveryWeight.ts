// Вес заказа для отгрузок: totalWeight уже посчитан калькулятором в каждой
// позиции items; фолбэк для старых заказов — плотность стекла 2.5 кг/(м²·мм).

export type WeighableItem = {
  totalWeight?: number
  areaPiece?: number
  quantity?: number
  thickness?: number
}

export function itemsWeight(items: WeighableItem[] | null | undefined): number {
  if (!Array.isArray(items)) return 0
  return items.reduce((s, it) => {
    if (typeof it.totalWeight === 'number' && it.totalWeight > 0) return s + it.totalWeight
    const area = (it.areaPiece ?? 0) * (it.quantity ?? 1)
    return s + area * (it.thickness ?? 0) * 2.5
  }, 0)
}
