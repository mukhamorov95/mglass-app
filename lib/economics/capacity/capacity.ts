import { batches, type Work } from '../batching/work'
import type { NormOp, NormSet } from '../standards/norms'
import type { Valued } from '../values'

// Люди и станки — разные ресурсы. Здесь человеко-часы; машинные минуты считаются отдельно и
// при отсутствии нормы остаются «нет значения».
export type OpHours = Partial<Record<NormOp, { labourH: number; setupH: number; machineH: number | null }>>

export function requiredHours(work: Work[], set: NormSet, factor = 1): { hours: OpHours; noNorm: NormOp[] } {
  const hours: OpHours = {}
  const noNorm = new Set<NormOp>()
  for (const b of batches(work)) {
    const n = set.norms.find(x => x.op === b.op)
    if (!n || n.status === 'missing') { noNorm.add(b.op); continue }
    const setup = (n.setupMin ?? 0) * factor / 60
    const run = ((n.perPartMin ?? 0) * b.parts + (n.perUnitMin ?? 0) * b.units) * factor / 60
    const machine = n.machineMinPerUnit == null ? null : ((n.machineSetupMin ?? 0) + n.machineMinPerUnit * b.units) * factor / 60
    const prev = hours[b.op] ?? { labourH: 0, setupH: 0, machineH: 0 }
    hours[b.op] = {
      labourH: prev.labourH + setup + run,
      setupH: prev.setupH + setup,
      machineH: prev.machineH == null || machine == null ? null : prev.machineH + machine,
    }
  }
  return { hours, noNorm: [...noNorm] }
}

export const totalLabourH = (hours: OpHours) => Object.values(hours).reduce((a, x) => a + (x?.labourH ?? 0), 0)

export type Pool = { id: string; label: string; ops: NormOp[]; hours: Valued }
export type CapacityPlan = { id: string; version: number; pools: Pool[] }

export type StaffScenario = {
  id: string
  label: string
  setHours?: Record<string, number> // новое распределение людей: часы участка целиком
  addHours: { poolId: string; hours: number }[]
  multiply: { poolIds: string[] | 'all'; factor: number } | null
  extraMonthlyCost: Valued
}

export type PoolLoad = { id: string; label: string; requiredH: number; availableH: number | null; utilization: number | null }

export function poolLoad(hours: OpHours, plan: CapacityPlan, scenario: StaffScenario) {
  const pools: PoolLoad[] = plan.pools.map(p => {
    const requiredH = p.ops.reduce((a, op) => a + (hours[op]?.labourH ?? 0), 0)
    const factor = scenario.multiply && (scenario.multiply.poolIds === 'all' || scenario.multiply.poolIds.includes(p.id)) ? scenario.multiply.factor : 1
    const added = scenario.addHours.filter(a => a.poolId === p.id).reduce((a, x) => a + x.hours, 0)
    const own = scenario.setHours?.[p.id] ?? p.hours.value
    const availableH = own == null ? null : own * factor + added
    return { id: p.id, label: p.label, requiredH, availableH, utilization: availableH ? requiredH / availableH : null }
  })
  const covered = new Set(plan.pools.flatMap(p => p.ops))
  const unassigned = (Object.keys(hours) as NormOp[]).filter(op => !covered.has(op))
    .map(op => ({ op, requiredH: hours[op]?.labourH ?? 0 }))
  const loaded = pools.filter(p => p.utilization != null && p.requiredH > 0)
  const bottleneck = loaded.sort((a, b) => (b.utilization ?? 0) - (a.utilization ?? 0))[0] ?? null
  // С неназначенными работами или неизвестными часами сказать «помещается» нельзя.
  const feasible: 'yes' | 'no' | 'unknown' = pools.some(p => (p.utilization ?? 0) > 1) ? 'no'
    : unassigned.length || pools.some(p => p.availableH == null && p.requiredH > 0) ? 'unknown' : 'yes'
  return { pools, unassigned, bottleneck, feasible }
}

// Станок — отдельное ограничение: второй человек у того же станка в ту же смену часов станку не добавляет.
export type Machine = { id: string; label: string; ops: NormOp[]; count: number | null; calendarHPerShift: Valued }

export function machineLoad(hours: OpHours, machine: Machine, shifts: number) {
  const parts = machine.ops.map(op => (hours[op] ? hours[op]!.machineH : 0))
  const requiredH = parts.some(x => x == null) ? null : parts.reduce<number>((a, x) => a + (x ?? 0), 0)
  const availableH = machine.count == null || machine.calendarHPerShift.value == null ? null
    : machine.count * machine.calendarHPerShift.value * shifts
  return { id: machine.id, label: machine.label, requiredH, availableH,
    utilization: requiredH != null && availableH ? requiredH / availableH : null }
}
