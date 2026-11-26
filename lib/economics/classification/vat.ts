import type { Status } from '../values'

// Диапазон вместо выдуманной ставки: lo — меньшая стоимость, hi — большая.
export type Range = { lo: number; hi: number }
export const point = (x: number): Range => ({ lo: x, hi: x })
export const ZERO: Range = point(0)
export const plus = (...r: Range[]): Range => r.reduce((a, b) => ({ lo: a.lo + b.lo, hi: a.hi + b.hi }), ZERO)
export const times = (r: Range, k: number): Range => ({ lo: r.lo * k, hi: r.hi * k })

export const MAX_VAT_RATE = 22

// none — без НДС; rate — ставка названа; from_document — НДС есть, ставка только в документе;
// unknown — режим не назван. В двух последних случаях стоимость лежит между «вычли максимум» и «не вычли».
export type VatRegime =
  | { kind: 'none'; status: Status }
  | { kind: 'rate'; rate: number; status: Status; needsConfirmation?: boolean }
  | { kind: 'from_document'; status: Status }
  | { kind: 'unknown' }

export function exVat(gross: number, vat: VatRegime): Range {
  const net = (rate: number) => gross / (1 + rate / 100)
  if (vat.kind === 'none') return point(gross)
  if (vat.kind === 'rate') return vat.needsConfirmation ? { lo: net(vat.rate), hi: gross } : point(net(vat.rate))
  return { lo: net(MAX_VAT_RATE), hi: gross }
}

export const vatKnown = (vat: VatRegime) => vat.kind === 'none' || (vat.kind === 'rate' && !vat.needsConfirmation)
