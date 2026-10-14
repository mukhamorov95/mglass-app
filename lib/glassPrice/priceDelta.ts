export type PriceChange = {
  matrix_name: string
  matrix_category: 'glass' | 'mirror'
  thickness: number
  old_value: number | null
  new_value: number
}

export type PriceDelta = { old: number; now: number; rub: number; pct: number }

// Разница показывается, только пока в ячейке стоит цена из прайса. Если её
// после применения поправили руками, «было» из журнала уже не предыдущая цена.
export function cellDelta(change: PriceChange | undefined, current: number | null): PriceDelta | null {
  if (!change || change.old_value == null || change.old_value <= 0) return null
  if (current == null || current !== change.new_value || current === change.old_value) return null
  const rub = current - change.old_value
  return { old: change.old_value, now: current, rub, pct: (rub / change.old_value) * 100 }
}

const MINUS = '−'

export function fmtRub(n: number): string {
  const abs = Math.abs(Math.round(n)).toLocaleString('ru-RU')
  return `${n > 0 ? '+' : n < 0 ? MINUS : ''}${abs}`
}

// Одна цифра после запятой: 0,2 % на 1 000 ₽ — это 2 ₽, меньше не бывает полезно.
export function fmtPct(p: number): string {
  const abs = Math.abs(p).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  return `${p > 0 ? '+' : p < 0 ? MINUS : ''}${abs} %`
}

export type DeltaSummary = { total: number; up: number; down: number; minPct: number; maxPct: number }

export function summarize(deltas: PriceDelta[]): DeltaSummary | null {
  if (deltas.length === 0) return null
  const pcts = deltas.map(d => d.pct)
  return {
    total: deltas.length,
    up: deltas.filter(d => d.rub > 0).length,
    down: deltas.filter(d => d.rub < 0).length,
    minPct: Math.min(...pcts),
    maxPct: Math.max(...pcts),
  }
}

export function changeKey(name: string, category: string, thickness: number): string {
  return `${name}|${category}|${thickness}`
}
