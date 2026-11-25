import type { B2BService } from '../types'

// Подогрев зеркала (владелец 25.11.2026): компонент справочника «Компоненты подсветки»
// с типом heating. Ставится и на зеркало с подсветкой, и на зеркало без неё.
// Продажа — sale_price из справочника (ставит Вера); пусто — та же формула, что у всего
// зеркала: себестоимость / (1 − маржа − налог) производства. Идёт строкой сверху цены изделия.

export type HeaterRow = { id: number; name: string; short_name: string | null; cost_price: number; sale_price?: number | null; voltage: number | null }

const HEAT_ID_BASE = -600_000   // выше надбавок (≤ −1 000 000) и отверстий (−500 000 − id)
export const heatingServiceId = (compId: number) => HEAT_ID_BASE - compId

export function heaterSale(h: HeaterRow, marginPct: number, taxPct: number): { sale: number; fromDirectory: boolean } {
  const own = Number(h.sale_price) || 0
  if (own > 0) return { sale: own, fromDirectory: true }
  const k = 1 - (marginPct + taxPct) / 100
  const cost = Number(h.cost_price) || 0
  return { sale: k > 0 ? Math.round(cost / k) : 0, fromDirectory: false }
}

export function heatingService(h: HeaterRow, n: number, marginPct: number, taxPct: number): B2BService | null {
  if (n <= 0) return null
  const { sale } = heaterSale(h, marginPct, taxPct)
  if (!(sale > 0)) return null
  return {
    id: heatingServiceId(h.id),
    name: `Подогрев ${h.short_name ?? h.name} × ${n}`,
    type: 'fixed',
    value: sale * n,
    cost_price: (Number(h.cost_price) || 0) * n,
    description: '',
    active: true,
    sort_order: 0,
  }
}

// 12-вольтовому подогреву нужен блок питания: без подсветки его никто не подобрал.
export const heaterNeedsPsu = (h: HeaterRow | null | undefined, hasLighting: boolean) =>
  !!h && h.voltage != null && h.voltage < 100 && !hasLighting
