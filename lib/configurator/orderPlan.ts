import {
  barConsumption, planBars, ROLE_META,
  type Library, type ModelKit, type KitQuantities, type KitOptions, type RoleId, type Stock, type BarPlan,
} from '@/lib/configurator/kit'

// Общий раскрой на ЗАКАЗ, а не на изделие. Когда в заказе несколько душевых, куски
// профиля и трубы одной и той же позиции кроятся из общего пула хлыстов: остаток от
// одного изделия идёт в дело у другого. Изолированный раскрой (изделие за изделием)
// теряет эти остатки — здесь считаем разницу как прямую экономию материала.
//
// Пул допустим только по ОДНОЙ И ТОЙ ЖЕ позиции справочника (itemId): из общего хлыста
// режется только одинаковый профиль. Разные артикулы не смешиваются.

export type OrderItemInput = { q: KitQuantities; lib: Library; kit: ModelKit; finishId: string; opts?: KitOptions }

export type PooledCut = {
  itemId: string
  name: string
  role: RoleId
  perItemBars: number       // хлыстов при раздельном раскрое (сумма по изделиям)
  pooledBars: number        // хлыстов при общем раскрое
  perItemCost: number
  pooledCost: number
  saving: number            // ≥ 0
  plan: BarPlan[]
  offcutMm: number          // метраж обрези (куплено − ушло в изделия)
}
export type OrderCuttingReport = {
  cuts: PooledCut[]
  perItemTotal: number      // себестоимость хлыстов при раздельном раскрое
  pooledTotal: number       // при общем
  saving: number            // perItemTotal − pooledTotal, ≥ 0
  offcutMm: number
}

const barCost = (pieces: number[], stocks: Stock[], kerf: number, splice: boolean) =>
  planBars(pieces, stocks, kerf, splice)

// Собираем по всему заказу вклады каждой bar-позиции: пул кусков + раздельная стоимость.
export function planOrderCutting(items: OrderItemInput[], kerf = 0): OrderCuttingReport {
  type Group = { name: string; role: RoleId; stocks: Stock[]; splice: boolean; pooled: number[]; perItemCost: number; perItemBars: number }
  const groups = new Map<string, Group>()

  for (const item of items) {
    for (const c of barConsumption(item.q, item.lib, item.kit, item.finishId, item.opts)) {
      const g = groups.get(c.itemId) ?? { name: c.name, role: c.role, stocks: c.stocks, splice: c.splice, pooled: [], perItemCost: 0, perItemBars: 0 }
      const solo = barCost(c.pieces, c.stocks, kerf, c.splice)   // как если бы это изделие кроили отдельно
      g.perItemCost += solo.cost
      g.perItemBars += solo.plan.length
      g.pooled.push(...c.pieces)
      groups.set(c.itemId, g)
    }
  }

  const cuts: PooledCut[] = []
  for (const [itemId, g] of groups) {
    const pooled = barCost(g.pooled, g.stocks, kerf, g.splice)
    const usedMm = g.pooled.reduce((s, p) => s + p, 0)
    const boughtMm = pooled.plan.reduce((s, b) => s + b.len, 0)
    cuts.push({
      itemId, name: g.name, role: g.role,
      perItemBars: g.perItemBars, pooledBars: pooled.plan.length,
      perItemCost: g.perItemCost, pooledCost: pooled.cost,
      saving: Math.max(0, g.perItemCost - pooled.cost),
      plan: pooled.plan, offcutMm: Math.max(0, boughtMm - usedMm),
    })
  }

  cuts.sort((a, b) => b.saving - a.saving)
  const perItemTotal = cuts.reduce((s, c) => s + c.perItemCost, 0)
  const pooledTotal = cuts.reduce((s, c) => s + c.pooledCost, 0)
  return {
    cuts,
    perItemTotal, pooledTotal,
    saving: Math.max(0, perItemTotal - pooledTotal),
    offcutMm: cuts.reduce((s, c) => s + c.offcutMm, 0),
  }
}

export const roleLabel = (r: RoleId) => ROLE_META[r].label
