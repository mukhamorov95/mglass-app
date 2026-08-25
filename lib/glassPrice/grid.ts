import type { RawPage, RawGrid, RawTextItem, RawCell } from './types'

const Y_TOL = 3.2   // разброс базовой линии внутри одной визуальной строки
const X_GAP = 6     // зазор, при котором соседние спаны считаются одной ячейкой

// Текстовые куски PDF → сетка строк/ячеек по геометрии (pdfjs отдаёт их в порядке
// отрисовки, а не чтения: заголовки секций в прайсе AIG рисуются после таблиц).
// Координата x у ячейки сохраняется — по ней парсер собирает колонки таблицы.
export function itemsToGrid(pages: RawPage[]): RawGrid[] {
  return pages.map(p => {
    const items = [...p.items].filter(i => i.text.trim()).sort((a, b) => a.y - b.y || a.x - b.x)
    const lines: RawTextItem[][] = []
    for (const it of items) {
      const last = lines[lines.length - 1]
      if (last && Math.abs(last[0].y - it.y) <= Y_TOL) last.push(it)
      else lines.push([it])
    }
    const rows = lines.map(line => {
      const sorted = [...line].sort((a, b) => a.x - b.x)
      const cells: RawCell[] = []
      for (const it of sorted) {
        const prev = cells[cells.length - 1]
        const end = it.x + (it.w ?? 0)
        if (prev && it.x - prev.end < X_GAP) { prev.text += ' ' + it.text.trim(); prev.end = end }
        else cells.push({ text: it.text.trim(), x: it.x, end })
      }
      return cells.map(c => ({ ...c, text: c.text.replace(/\s+/g, ' ').trim() }))
    })
    return { page: p.page, rows }
  })
}

// Сетка из xlsx: колонки без координат — раскладываем по индексу с шагом 100.
export function sheetToGrid(page: number, rows: (string | number | null | undefined)[][]): RawGrid {
  return {
    page,
    rows: rows.map(r => r
      .map((v, i) => ({ text: v == null ? '' : String(v).trim(), x: i * 100, end: i * 100 + 90 }))
      .filter(c => c.text)),
  }
}
