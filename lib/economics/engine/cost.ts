import { plus, times, ZERO, type Range } from '../classification/vat'
import type { Reader } from './reference'
import type { Rates, Center } from './rates'
import { minutesByCenter, type CenterId, type Consumption, type Missing } from './technology'

// Себестоимость заказа = прямые переменные + (человеко-минуты × ставка труда + станко-минуты ×
// ставка станка) + доли общепроизводственного и административного слоёв. Цену клиенту
// действующего калькулятора модуль не считает и не меняет: здесь экспериментальные границы.
export const VAT = 22

export type DirectLine = { label: string; cost: Range; note?: string }

export type CenterUse = {
  id: CenterId; label: string; machine: string | null
  labourMin: Range; setupMin: Range; machineMin: Range
  labourCost: Range; machineCost: Range
  labourShare: Range       // доля месячной практической мощности людей участка
  machineShare: Range | null
}

export type Bottleneck = { center: CenterId; kind: 'labour' | 'machine'; label: string; hours: Range; share: number }

export type OrderCost = {
  variable: Range
  direct: DirectLine[]
  uses: CenterUse[]
  resource: Range
  setupCost: Range
  overhead: Range
  admin: Range
  full: Range              // производственная: переменные + ресурсы + общепроизводственные
  sustainable: Range       // плюс административные и коммерческие
  floors: { variable: Range; production: Range; sustainable: Range }   // цены без НДС с комиссией
  bottleneck: Bottleneck | null
  missing: Missing[]
}

const per = (x: Range, y: number): Range => (y ? times(x, 1 / y) : ZERO)

// Комиссия берётся с суммы заказа с НДС (база не подтверждена), поэтому она входит в знаменатель:
// без НДС = V ÷ (1 − k × 1,22).
export function priceExVat(costWithoutCommission: Range, commission: Range): Range {
  const f = (v: number, k: number) => {
    const d = 1 - k * (1 + VAT / 100)
    if (d <= 0) throw new Error('Комиссия не оставляет цены')
    return v / d
  }
  return { lo: f(costWithoutCommission.lo, commission.lo), hi: f(costWithoutCommission.hi, commission.hi) }
}

export const commissionRate = (ref: Reader): Range => times(ref.get('fin.commission.pct') ?? ZERO, 1 / 100)

export function centerUses(u: Pick<Consumption, 'ops' | 'setups'>, rates: Rates, shifts = 1): CenterUse[] {
  const mins = minutesByCenter(u)
  return rates.centers.filter(c => mins[c.id]).map((c: Center) => {
    const m = mins[c.id]!
    const labourCost = { lo: m.labour.lo * c.labourRate.lo, hi: m.labour.hi * c.labourRate.hi }
    const machineCost = c.machineRate ? { lo: m.machine.lo * c.machineRate.lo, hi: m.machine.hi * c.machineRate.hi } : ZERO
    return {
      id: c.id, label: c.label, machine: c.machine,
      labourMin: m.labour, setupMin: m.setupLabour, machineMin: c.machine ? m.machine : ZERO,
      labourCost, machineCost,
      labourShare: per(m.labour, c.labourPracticalMin * shifts),
      machineShare: c.machinePracticalMin ? per(m.machine, c.machinePracticalMin * shifts) : null,
    }
  })
}

export function bottleneckOf(uses: CenterUse[]): Bottleneck | null {
  const all: Bottleneck[] = uses.flatMap(u => [
    { center: u.id, kind: 'labour' as const, label: `${u.label}: люди`, hours: per(u.labourMin, 60), share: u.labourShare.hi },
    ...(u.machineShare ? [{ center: u.id, kind: 'machine' as const, label: `${u.label}: станок ${u.machine}`, hours: per(u.machineMin, 60), share: u.machineShare.hi }] : []),
  ])
  return all.filter(b => b.share > 0).sort((a, b) => b.share - a.share)[0] ?? null
}

export function absorb(resource: Range, rates: Rates) {
  const base = plus(...rates.centers.map(c => plus(c.labourMonth, c.siteMonth)))
  // Слой накладных: доля «сколько ресурсов взял заказ из того, что дают участки за месяц».
  // При неполной загрузке остаток не раскладывается — это расход периода.
  const share: Range = { lo: base.lo ? resource.lo / base.lo : 0, hi: base.hi ? resource.hi / base.hi : 0 }
  // Для логистики подробных норм нет, поэтому она идёт тем же драйвером, что и накладные цеха.
  const over = plus(rates.overhead, rates.logistics)
  return {
    overhead: { lo: over.lo * share.lo, hi: over.hi * share.hi },
    admin: { lo: rates.admin.lo * share.lo, hi: rates.admin.hi * share.hi },
  }
}

export function orderCost(args: {
  consumption: Consumption
  direct: DirectLine[]
  directMissing?: Missing[]
  rates: Rates
  commission: Range
  shifts?: number
}): OrderCost {
  const { consumption: u, direct, rates, commission } = args
  const uses = centerUses(u, rates, args.shifts)
  const variable = plus(...direct.map(d => d.cost))
  const resource = plus(...uses.map(x => plus(x.labourCost, x.machineCost)))
  const setupCost = plus(...u.setups.map(s => {
    const c = rates.centers.find(x => x.id === s.center)!
    return plus({ lo: s.labourMin.lo * c.labourRate.lo, hi: s.labourMin.hi * c.labourRate.hi },
      c.machineRate ? { lo: s.machineMin.lo * c.machineRate.lo, hi: s.machineMin.hi * c.machineRate.hi } : ZERO)
  }))
  const layers = absorb(resource, rates)
  const full = plus(variable, resource, layers.overhead)
  const sustainable = plus(full, layers.admin)
  return {
    variable, direct, uses, resource, setupCost, ...layers, full, sustainable,
    floors: {
      variable: priceExVat(variable, commission),
      production: priceExVat(full, commission),
      sustainable: priceExVat(sustainable, commission),
    },
    bottleneck: bottleneckOf(uses),
    missing: [...(args.directMissing ?? []), ...u.missing],
  }
}

export type Margin = { revenueExVat: number; commission: Range; md: Range; mdPerLabourH: Range | null; mdPerBottleneckH: Range | null }

export function margin(c: OrderCost, revenueExVat: number, rate: Range): Margin {
  const com = times(rate, revenueExVat * (1 + VAT / 100))
  const md = { lo: revenueExVat - c.variable.hi - com.hi, hi: revenueExVat - c.variable.lo - com.lo }
  const labour = per(plus(...c.uses.map(u => u.labourMin)), 60)
  // Меньше МД и больше часов — нижний край, наоборот — верхний.
  const perHour = (h: Range): Range | null => (h.lo > 0 && h.hi > 0
    ? { lo: md.lo / (md.lo >= 0 ? h.hi : h.lo), hi: md.hi / (md.hi >= 0 ? h.lo : h.hi) } : null)
  return { revenueExVat, commission: com, md, mdPerLabourH: perHour(labour),
    mdPerBottleneckH: c.bottleneck ? perHour(c.bottleneck.hours) : null }
}

// Цена под заданную владельцем цель МД на час ограничивающего ресурса. Без цели рекомендованной
// цены нет: маржа из головы не назначается.
export function targetPrice(c: OrderCost, mdPerHour: number, commission: Range): Range | null {
  if (!c.bottleneck || !(mdPerHour > 0)) return null
  return priceExVat(plus(c.variable, times(c.bottleneck.hours, mdPerHour)), commission)
}
