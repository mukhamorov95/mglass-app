import { plus, times, ZERO, type Range } from '../classification/vat'
import type { Reader } from './reference'
import type { Rates } from './rates'
import type { CenterUse } from './cost'
import type { CenterId } from './technology'

// Люди и станки считаются раздельно: ещё один человек добавляет человеко-часы, но не станко-часы.
// Смены умножают оба фонда. Загрузка — требуется ÷ практический фонд.
export type ShopScenario = { id: string; label: string; shifts: number; labourHours: Partial<Record<CenterId, number>>; extraMonthly: Range | null; pooled?: boolean }

// Часы людей по участкам для сценария берутся из закрытого справочника: fin.scn.<id>.hours.<участок>.
export function shopScenarios(ref: Reader): ShopScenario[] {
  const ids = [...new Set(ref.keys('fin.scn.').map(k => k.split('.')[2]))]
  return ids.map(id => {
    const labourHours: Partial<Record<CenterId, number>> = {}
    for (const k of ref.keys(`fin.scn.${id}.hours.`)) labourHours[k.split('.')[4] as CenterId] = ref.get(k)?.lo
    const meta = ref.param(`fin.scn.${id}.shifts`)
    return { id, label: String(meta?.attrs?.title ?? id), shifts: ref.get(`fin.scn.${id}.shifts`)?.lo ?? 1,
      labourHours, extraMonthly: ref.get(`fin.scn.${id}.extraMonthly`), pooled: meta?.attrs?.pooled === 1 }
  })
}

export function sumUses(all: CenterUse[][]) {
  const out = new Map<CenterId, { labourMin: Range; machineMin: Range; cost: Range }>()
  for (const u of all.flat()) {
    const x = out.get(u.id) ?? { labourMin: ZERO, machineMin: ZERO, cost: ZERO }
    out.set(u.id, { labourMin: plus(x.labourMin, u.labourMin), machineMin: plus(x.machineMin, u.machineMin), cost: plus(x.cost, u.labourCost, u.machineCost) })
  }
  return out
}

export type Load = { id: CenterId | 'pooled'; label: string; kind: 'labour' | 'machine'; requiredH: Range; availableH: number | null; utilization: Range | null }

export function shopLoad(uses: CenterUse[][], rates: Rates, s: ShopScenario) {
  const sum = sumUses(uses)
  const loads: Load[] = []
  const load = (id: Load['id'], label: string, kind: Load['kind'], requiredH: Range, availableH: number | null) =>
    loads.push({ id, label, kind, requiredH, availableH, utilization: availableH ? times(requiredH, 1 / availableH) : null })
  for (const c of rates.centers) {
    const x = sum.get(c.id)
    const base = s.labourHours[c.id] ?? c.labourPracticalMin / 60
    load(c.id, c.label, 'labour', times(x?.labourMin ?? ZERO, 1 / 60), base * s.shifts || null)
    if (c.machine && c.machinePracticalMin) {
      load(c.id, c.machine, 'machine', times(x?.machineMin ?? ZERO, 1 / 60), c.machinePracticalMin / 60 * s.shifts)
    }
  }
  // Перераспределение: матрицы умений нет, поэтому показан только предел при полной взаимозаменяемости.
  if (s.pooled) {
    const labour = loads.filter(l => l.kind === 'labour')
    const required = plus(...labour.map(l => l.requiredH))
    const available = labour.reduce((a, l) => a + (l.availableH ?? 0), 0)
    const machines = loads.filter(l => l.kind === 'machine')
    loads.length = 0
    load('pooled', 'Все люди вместе (предел при взаимозаменяемости)', 'labour', required, available || null)
    loads.push(...machines)
  }
  const worst = [...loads].filter(l => l.utilization && l.utilization.hi > 0).sort((a, b) => b.utilization!.hi - a.utilization!.hi)[0] ?? null
  // Во сколько раз можно увеличить тот же набор заказов, пока самый занятый ресурс не заполнен.
  const headroom = worst ? { lo: 1 / worst.utilization!.hi, hi: worst.utilization!.lo > 0 ? 1 / worst.utilization!.lo : Infinity } : null
  return { loads, bottleneck: worst, headroom }
}

export function unused(uses: CenterUse[][], rates: Rates) {
  const sum = sumUses(uses)
  return rates.centers.map(c => {
    const cost = plus(c.labourMonth, c.siteMonth)
    const used = sum.get(c.id)?.cost ?? ZERO
    return { id: c.id, label: c.label, cost, used, unused: { lo: cost.lo - used.hi, hi: cost.hi - used.lo } }
  })
}
