// Крупная деталь — целым листом (владелец 21.10, заказ 05662: три сатина 1155×2772 = три купленных
// листа). Если рядом с деталью на рабочем поле листа не ложится вторая такая же, позиция платит
// лист целиком по полной площади; остаток уходит на склад бесплатно. Мелкие детали — как раньше,
// по расходу из справочника. Рабочее поле — лист без нерабочей кромки: у матовых по 10 мм вдоль
// обеих длинных сторон (3210×2250 → 3210×2230).

export type SheetSpec = { sheet_width?: number | null; sheet_height?: number | null; sheet_edge_mm?: number | null }

export function workingField(s: SheetSpec): { long: number; short: number } | null {
  const w = Number(s.sheet_width) || 0
  const h = Number(s.sheet_height) || 0
  if (w <= 0 || h <= 0) return null
  const edge = Math.max(0, Number(s.sheet_edge_mm) || 0)
  const short = Math.min(w, h) - 2 * edge
  return short > 0 ? { long: Math.max(w, h), short } : null
}

// Одинаковые детали сеткой, в любой из двух ориентаций; смешанная укладка двух штук этим тоже ловится
export function piecesPerSheet(width: number, height: number, field: { long: number; short: number }): number {
  const fit = (a: number, b: number) => Math.floor(field.long / a) * Math.floor(field.short / b)
  return Math.max(fit(width, height), fit(height, width))
}

// Сколько целых листов берёт позиция; null — правило не действует: деталь мелкая или на лист не ложится вовсе
export function wholeSheetsFor(width: number, height: number, quantity: number, s: SheetSpec): number | null {
  const field = workingField(s)
  if (!field || !(width > 0) || !(height > 0) || !(quantity > 0)) return null
  return piecesPerSheet(width, height, field) === 1 ? quantity : null
}

export function sheetAreaM2(s: SheetSpec): number {
  return (Number(s.sheet_width) || 0) * (Number(s.sheet_height) || 0) / 1_000_000
}
