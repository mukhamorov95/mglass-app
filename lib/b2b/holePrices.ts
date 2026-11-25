import type { B2BService } from '../types'
import type { HoleGroup } from '../production/holes'

// Отверстия считаются отдельно по диаметру и толщине стекла (владелец 25.11.2026).
// Справочник b2b_hole_prices: полоса диаметра «до d_max» × полоса толщины «до t_max»,
// цена за одно отверстие. Полосы смежные: Ø13 попадает в «до 30», 8 мм — в «до 19».

export type HolePrice = { id: number; d_max: number; t_max: number; sale: number; cost: number }

// Синтетический id строки услуги: отрицательный (не восстанавливается галочкой в правке),
// но выше диапазона надбавок (-1 000 000 и ниже, lib/surcharges.ts).
const HOLE_ID_BASE = -500_000
export const holeServiceId = (rowId: number) => HOLE_ID_BASE - rowId
export const isHoleServiceId = (id: number) => id <= HOLE_ID_BASE && id > -1_000_000

const sorted = (rows: HolePrice[]) => [...rows].sort((a, b) => a.t_max - b.t_max || a.d_max - b.d_max)

export function holeBand(d: number, thickness: number, rows: HolePrice[]): HolePrice | null {
  const list = sorted(rows)
  const tMax = list.find(r => thickness <= r.t_max)?.t_max
  if (tMax === undefined) return null
  return list.find(r => r.t_max === tMax && d <= r.d_max) ?? null
}

// «Ø14–30» — от конца предыдущей полосы той же толщины.
export function bandLabel(row: HolePrice, rows: HolePrice[]): string {
  const prev = sorted(rows).filter(r => r.t_max === row.t_max && r.d_max < row.d_max).pop()
  return prev ? `Ø${prev.d_max + 1}–${row.d_max}` : `Ø до ${row.d_max}`
}

export function thicknessLabel(row: HolePrice, rows: HolePrice[]): string {
  const prev = sorted(rows).filter(r => r.t_max < row.t_max).pop()
  return prev ? `${prev.t_max + 1}–${row.t_max} мм` : `до ${row.t_max} мм`
}

export function holeProblems(hasHoles: boolean, groups: HoleGroup[], thickness: number, rows: HolePrice[]): string[] {
  if (hasHoles && groups.length === 0) return ['Отверстия: укажите диаметр и количество']
  const out: string[] = []
  for (const g of groups) {
    const r = holeBand(g.d, thickness, rows)
    if (!r) out.push(`Отверстие Ø${g.d} при ${thickness} мм: нет в справочнике`)
    else if (!(Number(r.sale) > 0)) out.push(`Отверстие Ø${g.d}: не задана цена`)
  }
  return out
}

// Строки услуг: одна на полосу диаметра, цена × отверстий на деталь (движок умножит на детали).
export function holeServices(groups: HoleGroup[], thickness: number, rows: HolePrice[]): B2BService[] {
  const byRow = new Map<number, { row: HolePrice; n: number }>()
  for (const g of groups) {
    const r = holeBand(g.d, thickness, rows)
    if (!r || g.n <= 0) continue
    const cur = byRow.get(r.id)
    byRow.set(r.id, { row: r, n: (cur?.n ?? 0) + g.n })
  }
  return [...byRow.values()].sort((a, b) => a.row.d_max - b.row.d_max).map(({ row, n }) => ({
    id: holeServiceId(row.id),
    name: `Отверстие ${bandLabel(row, rows)} × ${n}`,
    type: 'fixed' as const,
    value: (Number(row.sale) || 0) * n,
    cost_price: (Number(row.cost) || 0) * n,
    description: '',
    active: true,
    sort_order: 0,
  }))
}
