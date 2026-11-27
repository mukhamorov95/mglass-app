import { exVat, plus, times, ZERO, type Range, type VatRegime } from '../classification/vat'
import type { NormOp } from '../standards/norms'
import type { CapacityPlan, OpHours } from '../capacity/capacity'
import type { Valued } from '../values'

// TDABC: ставка ресурсного центра = его месячная стоимость / практическая мощность в часах;
// заказ получает время по нормам × ставку своего центра. Старые тарифы операций не участвуют.
// Общепроизводственные и административно-коммерческие расходы — отдельные слои со своим,
// настраиваемым драйвером; единой ставки «все расходы на человеко-час» нет.
export type CostBucket =
  | 'payroll_centers'      // оплата труда, уже разнесённая по участкам (Centers)
  | 'logistics'            // транспорт: делится между центрами логистики по их часам
  | 'warehouse'
  | 'overhead'
  | 'admin'
  | 'overhead_or_admin'    // не разделено: край диапазона цеха, в полной сумме — один раз
export type ResourceLine = { name: string; amount: Valued; vat: VatRegime; bucket: CostBucket }
export type ResourceProfile = { id: string; kind: 'current' | 'target'; version: number; areaM2: number; lines: ResourceLine[] }

// Закрытые данные: сумма оплаты труда за месяц, приходящаяся на участок. Только из локального входа.
export type Centers = { id: string; version: number; byPool: Record<string, number> }

export const LOGISTICS_POOLS = ['logistics', 'purchasing']

const bucketSum = (p: ResourceProfile, bucket: CostBucket) =>
  plus(...p.lines.filter(l => l.bucket === bucket && l.amount.value != null).map(l => exVat(l.amount.value!, l.vat)))

export type CenterCost = { id: string; label: string; practicalH: number | null; cost: Range | null; rate: Range | null }

export type CostModel = {
  centers: CenterCost[]
  overhead: Range
  admin: Range
  unsplit: Range
  warehouse: Range | null
  total: Range
  missing: string[]
}

export function costModel(p: ResourceProfile, labour: Centers, plan: CapacityPlan): CostModel {
  const logistics = bucketSum(p, 'logistics')
  const logisticsH = plan.pools.filter(x => LOGISTICS_POOLS.includes(x.id)).reduce((a, x) => a + (x.hours.value ?? 0), 0)
  const centers = plan.pools.map((pool): CenterCost => {
    const share = LOGISTICS_POOLS.includes(pool.id) && logisticsH ? (pool.hours.value ?? 0) / logisticsH : 0
    const own = labour.byPool[pool.id]
    const cost = own == null && !share ? null : plus({ lo: own ?? 0, hi: own ?? 0 }, times(logistics, share))
    const h = pool.hours.value
    return { id: pool.id, label: pool.label, practicalH: h, cost, rate: cost && h ? times(cost, 1 / h) : null }
  })
  const overhead = bucketSum(p, 'overhead'), admin = bucketSum(p, 'admin'), unsplit = bucketSum(p, 'overhead_or_admin')
  const hasWarehouse = p.lines.some(l => l.bucket === 'warehouse' && l.amount.value != null)
  const warehouse = hasWarehouse ? bucketSum(p, 'warehouse') : null
  const total = plus(...centers.map(c => c.cost ?? ZERO), overhead, admin, unsplit, warehouse ?? ZERO)
  return {
    centers, overhead, admin, unsplit, warehouse, total,
    missing: [...p.lines.filter(l => l.amount.value == null).map(l => l.name),
      ...(hasWarehouse ? [] : ['склад: расходы отдельно не выделены']),
      ...centers.filter(c => c.rate == null).map(c => `центр без ставки: ${c.label}`)],
  }
}

// Проверка от двойного счёта и потерь: разнесённое по участкам равно статье оплаты труда.
export function payrollMismatch(labour: Centers, p: ResourceProfile): number {
  const payroll = p.lines.filter(l => l.bucket === 'payroll_centers').reduce((a, l) => a + (l.amount.value ?? 0), 0)
  return Object.values(labour.byPool).reduce((a, x) => a + x, 0) - payroll
}

export type CenterUse = { centerId: string | null; op: NormOp; hours: number; cost: Range }

export function orderUse(hours: OpHours, plan: CapacityPlan, model: CostModel): CenterUse[] {
  const rates = model.centers.filter(c => c.rate && !LOGISTICS_POOLS.includes(c.id)).map(c => c.rate!)
  const cheapest = Math.min(...rates.map(r => r.lo)), dearest = Math.max(...rates.map(r => r.hi))
  return (Object.entries(hours) as [NormOp, NonNullable<OpHours[NormOp]>][]).map(([op, h]) => {
    const pool = plan.pools.find(p => p.ops.includes(op))
    const rate = pool ? model.centers.find(c => c.id === pool.id)?.rate : null
    // Исполнитель не назван: час стоит от самого дешёвого участка цеха до самого дорогого.
    return { centerId: rate ? pool!.id : null, op, hours: h.labourH,
      cost: rate ? times(rate, h.labourH) : { lo: h.labourH * cheapest, hi: h.labourH * dearest } }
  })
}

export type Driver = 'resource_cost' | 'labour_minutes'
export type Layers = { resource: Range; overhead: Range; admin: Range }

// Слой накладных получает долю «что взял заказ / что дают центры при практической мощности».
// При полной загрузке слой распределяется ровно один раз, при неполной остаток не распределён.
export function orderLayers(use: CenterUse[], model: CostModel, driver: Driver): Layers {
  const resource = plus(...use.map(u => u.cost))
  const priced = model.centers.filter(c => c.cost && c.practicalH)
  const baseCost = plus(...priced.map(c => c.cost!))
  const baseH = priced.reduce((a, c) => a + c.practicalH!, 0)
  const hours = use.reduce((a, u) => a + u.hours, 0)
  const share: Range = driver === 'labour_minutes'
    ? { lo: hours / baseH, hi: hours / baseH }
    : { lo: resource.lo / baseCost.lo, hi: resource.hi / baseCost.hi }
  const warehouse = model.warehouse ?? ZERO
  const overhead = plus(model.overhead, warehouse)
  // Цех: неразделённое может не относиться к нему вовсе (низ) или целиком (верх).
  const production: Range = { lo: overhead.lo * share.lo, hi: (overhead.hi + model.unsplit.hi) * share.hi }
  const all = plus(overhead, model.unsplit, model.admin)
  const full: Range = { lo: all.lo * share.lo, hi: all.hi * share.hi }
  return { resource, overhead: production, admin: { lo: full.lo - production.lo, hi: full.hi - production.hi } }
}

export const productionCost = (variable: Range, l: Layers) => plus(variable, l.resource, l.overhead)
export const sustainableCost = (variable: Range, l: Layers) => plus(variable, l.resource, l.overhead, l.admin)

// Стоимость неиспользованной мощности по центрам: стоимость центра минус отнесённое на заказы.
// Отрицательное значение не прячется: заказы взяли больше практической мощности.
export function unusedCapacity(uses: CenterUse[][], model: CostModel) {
  return model.centers.map(c => {
    const used = uses.flat().filter(u => u.centerId === c.id)
    const usedH = used.reduce((a, u) => a + u.hours, 0)
    const usedCost = plus(...used.map(u => u.cost))
    return {
      ...c, usedH, usedCost,
      unusedH: c.practicalH == null ? null : c.practicalH - usedH,
      unusedCost: c.cost ? { lo: c.cost.lo - usedCost.lo, hi: c.cost.hi - usedCost.hi } : null,
    }
  })
}

// Денежный остаток: сколько МД в месяц нужно, чтобы покрыть расходы и оставить цель.
export function cashTarget(md: Range, fixed: Range, target: number) {
  const required: Range = plus(fixed, { lo: target, hi: target })
  return {
    target, required,
    surplus: { lo: md.lo - fixed.hi, hi: md.hi - fixed.lo },
    gap: { lo: Math.max(0, required.lo - md.hi), hi: Math.max(0, required.hi - md.lo) },
    // Во сколько раз нужен объём той же структуры и при тех же ценах.
    volumeFactor: { lo: md.hi > 0 ? required.lo / md.hi : Infinity, hi: md.lo > 0 ? required.hi / md.lo : Infinity },
  }
}

export type Coverage = 'certain' | 'possible' | 'covered'
export const coverage = (revenueExVat: number, floor: Range): Coverage =>
  revenueExVat < floor.lo ? 'certain' : revenueExVat < floor.hi ? 'possible' : 'covered'
