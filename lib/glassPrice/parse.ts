import type { RawGrid, RawCell, ParseResult, ParsedTable, ParsedItem } from './types'

export const PARSER_VERSION = 2

const NA = /^(н\/д|нд|—|-|–|по запросу|по согласованию|\*)$/i
const SIZE_RE = /^\d{3,4}\s*[хxХX*]\s*\d{3,4}$/
const COL_TOL = 34          // разброс x, при котором ячейки считаются одной колонкой
const HEAD_TOL = 90         // насколько далеко от колонки может стоять её заголовок

export function parsePrice(raw: string): number | null | undefined {
  const s = raw.replace(/ /g, ' ').trim()
  if (!s) return undefined
  if (NA.test(s)) return null
  const cleaned = s.replace(/\s/g, '').replace(/руб\.?$/i, '').replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return undefined
  const n = Number(cleaned)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

// «4,00 мм» → 4 ; «33.1» (код триплекса) → код без толщины
export function parseVariant(raw: string): { code: string; thicknessMm: number | null } | null {
  const s = raw.replace(/ /g, ' ').trim()
  const mm = s.match(/^(\d{1,2}(?:[.,]\d{1,2})?)\s*мм\.?$/i)
  if (mm) { const v = Number(mm[1].replace(',', '.')); return { code: String(v), thicknessMm: v } }
  const triplex = s.match(/^(\d{2}\.\d)$/)
  if (triplex) return { code: triplex[1], thicknessMm: null }
  return null
}

const DESCRIPTION = /^(формат|приложение|прейскурант|цены на|доставка|высококач|многослойн|солнцезащ|непрозрачн|разнообразн|стекло многослойн|матированное зеркальное|\*\*|\d\.\s)/i

function isDescription(text: string): boolean {
  return text.length > 60 || DESCRIPTION.test(text)
}

// Строка-заголовок секции: «Planiglass | ПРОЗРАЧНОЕ ИЛИ ТОНИРОВАННОЕ СТЕКЛО».
// leftEdge — левый край колонок таблицы: заголовок секции всегда левее их,
// иначе это фрагмент шапки колонки («Clear», «Green»).
function sectionTitle(cells: RawCell[], codeX: number): string | null {
  if (cells.length === 0 || cells.length > 2) return null
  if (cells[0].x > codeX + 8) return null   // правее колонки «Толщина» — это фрагмент шапки
  const head = cells[0].text
  if (head.length < 3 || head.length > 60) return null
  if (/^[a-zа-я\d]/.test(head)) return null            // строчная буква/цифра — это проза, не заголовок
  if (head.endsWith('.') || head.endsWith(',')) return null
  if (isDescription(head)) return null
  if (/@|www\./.test(head)) return null
  if (cells.some(c => parsePrice(c.text) !== undefined)) return null
  return head
}

// Повторяющиеся на каждой странице шапки/подвалы — убрать до разбора.
function dropRepeatedRows(pages: RawGrid[]): RawGrid[] {
  const seen = new Map<string, Set<number>>()
  for (const p of pages) {
    for (const row of p.rows) {
      const key = row.map(c => c.text).join('|')
      if (!seen.has(key)) seen.set(key, new Set())
      seen.get(key)!.add(p.page)
    }
  }
  const repeated = new Set([...seen.entries()].filter(([, ps]) => ps.size > 1).map(([k]) => k))
  return pages.map(p => ({ page: p.page, rows: p.rows.filter(r => !repeated.has(r.map(c => c.text).join('|'))) }))
}

type Block = { start: number; end: number; rows: RawCell[][] }

function isDataRow(row: RawCell[]): boolean {
  return row.length >= 2 && parseVariant(row[0].text) !== null
}

function clusterColumns(rows: RawCell[][]): number[] {
  const xs: number[] = []
  for (const row of rows) for (const c of row.slice(1)) xs.push(c.x)
  xs.sort((a, b) => a - b)
  const cols: number[] = []
  let group: number[] = []
  for (const x of xs) {
    if (group.length === 0 || x - group[group.length - 1] <= COL_TOL) group.push(x)
    else { cols.push(group.reduce((s, v) => s + v, 0) / group.length); group = [x] }
  }
  if (group.length) cols.push(group.reduce((s, v) => s + v, 0) / group.length)
  return cols
}

function nearestCol(cols: number[], x: number, tol: number): number {
  let best = -1, bestD = Infinity
  for (let i = 0; i < cols.length; i++) {
    const d = Math.abs(cols[i] - x)
    if (d < bestD) { bestD = d; best = i }
  }
  return bestD <= tol ? best : -1
}

const NOISE_TOKEN = /^(прозрачное|прозрачный|прозрачная|бесцветные|бесцветное|бронз\.?|бронзовое|бронзовый|сер(ый|ое|ая)|зелен(ый|ое)|просветлен(ое|ное)|стекло|пр-во|производство|росси(я|и)|рф|на|с|одной|стороны|матовая|пленка|без|напыления|энергосберегающим|покрытием|флоате|марки|пр-|во|просветленн\\w*|энергосбер\\w*|напылени\\w*|полотно)$/i

// Имя колонки — только «именующие» слова шапки: марка/цвет. Описания
// («прозрачное,», «пр-во Россия») отбрасываем — иначе имя нечитаемо и ломает маппинг.
export function cleanColumnName(parts: string[]): string {
  const tokens = parts
    .join(' ')
    .replace(/\s+/g, ' ')
    .split(' ')
    .map(t => t.trim())
    .filter(Boolean)
  const kept: string[] = []
  for (const t of tokens) {
    const bare = t.replace(/[,;.]+$/, '')
    if (!bare || NOISE_TOKEN.test(bare)) continue
    if (kept[kept.length - 1]?.replace(/[,;.]+$/, '').toLowerCase() === bare.toLowerCase()) continue
    kept.push(t)
  }
  const src = kept.length ? kept : tokens
  return src.join(' ').replace(/[,;]\s*$/, '').trim().slice(0, 60)
}

// Сетка прайса → таблицы. Колонки собираются по координате x, поэтому пропуски
// («н/д» отсутствует ячейкой) не сдвигают цены в соседний столбец.
export function parseGlassPriceGrid(rawPages: RawGrid[]): ParseResult {
  const pages = dropRepeatedRows(rawPages)
  const tables: ParsedTable[] = []
  const warnings: string[] = []

  for (const page of pages) {
    const rows = page.rows
    const blocks: Block[] = []
    let cur: Block | null = null
    rows.forEach((row, i) => {
      if (isDataRow(row)) {
        if (cur && i - cur.end <= 2) { cur.rows.push(row); cur.end = i }
        else { cur = { start: i, end: i, rows: [row] }; blocks.push(cur) }
      }
    })

    let prevBlockEnd = -1
    for (const block of blocks) {
      const cols = clusterColumns(block.rows)
      if (cols.length === 0) continue
      const codeX = Math.min(...block.rows.map(r => r[0].x))

      // значения по колонкам
      const matrix: (string | null)[][] = block.rows.map(row => {
        const line: (string | null)[] = new Array(cols.length).fill(null)
        for (const c of row.slice(1)) {
          const idx = nearestCol(cols, c.x, COL_TOL * 2)
          if (idx >= 0) line[idx] = line[idx] ? `${line[idx]} ${c.text}` : c.text
        }
        return line
      })

      // заголовки: всё, что выше блока, разложить по тем же колонкам
      const headParts: string[][] = cols.map(() => [])
      let section = ''
      for (let i = block.start - 1; i > prevBlockEnd; i--) {
        const row = rows[i]
        const title = sectionTitle(row, codeX)
        // ближайший заголовок сверху, но фирменный (с ®) важнее подзаголовка
        if (title) { if (!section || (!section.includes('®') && title.includes('®'))) section = title; continue }
        // строка целиком левее колонок (подпись/проза у левого поля) — в шапку не идёт
        if (row[0].x <= codeX + 8 && row.length <= 2) continue
        for (const c of row) {
          if (isDescription(c.text) || /^толщин/i.test(c.text) || c.text.length > 32) continue
          const idx = nearestCol(cols, c.x, HEAD_TOL)
          if (idx >= 0 && c.x > codeX + 20) headParts[idx].unshift(c.text)
        }
      }
      prevBlockEnd = block.end

      // колонки с кодами толщин («33.2» рядом с «33.1») — начало второй таблицы на той же строке
      const codeCol = cols.map((_, i) => {
        const vals = matrix.map(r => r[i]).filter(Boolean) as string[]
        return vals.length > 0 && vals.filter(v => parseVariant(v)).length / vals.length > 0.6
      })

      const groups: number[][] = []
      let g: number[] = []
      cols.forEach((_, i) => {
        if (codeCol[i]) { if (g.length) groups.push(g); g = [] } else g.push(i)
      })
      if (g.length) groups.push(g)

      groups.forEach((colIdx, gi) => {
        const codeSource = gi === 0 ? -1 : cols.findIndex((_, i) => codeCol[i] && i < colIdx[0] && i > (groups[gi - 1]?.[groups[gi - 1].length - 1] ?? -1))
        const names = colIdx.map((i, n) => cleanColumnName(headParts[i]) || `Колонка ${n + 1}`)
        const priceIdx = names.findIndex(n => /цена/i.test(n))
        const nameIdx = names.findIndex(n => /^назван/i.test(n))
        const sizeIdx = names.findIndex(n => /размер/i.test(n))
        const attrIdx = names.map((n, i) => i !== priceIdx && i !== nameIdx && i !== sizeIdx && priceIdx >= 0 ? i : -1).filter(i => i >= 0)

        const table: ParsedTable = {
          section,
          page: page.page,
          columns: priceIdx >= 0 ? ['Цена за кв.м.'] : names,
          rows: [],
        }

        block.rows.forEach((row, r) => {
          const codeText = codeSource >= 0 ? (matrix[r][codeSource] ?? '') : row[0].text
          const variant = parseVariant(codeText)
          if (!variant) return
          const vals = colIdx.map(i => matrix[r][i])
          if (vals.every(v => v == null)) return

          if (priceIdx >= 0) {
            const price = parsePrice(vals[priceIdx] ?? '')
            const attr = (nameIdx >= 0 ? vals[nameIdx] : null) ?? attrIdx.map(i => vals[i]).filter(Boolean).join(' ').trim()
            const note = (nameIdx >= 0 ? attrIdx.map(i => vals[i]).filter(Boolean).join(' ') : '').trim()
            const size = (sizeIdx >= 0 ? vals[sizeIdx] : null) ?? ''
            table.rows.push({
              code: variant.code, thicknessMm: variant.thicknessMm,
              attr: attr ?? '', note, sheetFormat: SIZE_RE.test(size) ? size : '',
              cells: [price === undefined ? null : price],
            })
          } else {
            table.rows.push({
              code: variant.code, thicknessMm: variant.thicknessMm, attr: '', note: '', sheetFormat: '',
              cells: vals.map(v => { const p = parsePrice(v ?? ''); return p === undefined ? null : p }),
            })
          }
        })

        if (table.rows.length) tables.push(table)
      })
    }
  }

  const items = tablesToItems(tables, warnings)
  return { tables, items, warnings }
}

function tablesToItems(tables: ParsedTable[], warnings: string[]): ParsedItem[] {
  const items: ParsedItem[] = []
  const seen = new Set<string>()
  let sortOrder = 0

  for (const t of tables) {
    const byAttr = t.columns.length === 1 && /цена/i.test(t.columns[0])
    for (const row of t.rows) {
      const cols = byAttr ? [row.attr || t.section] : t.columns
      for (let i = 0; i < cols.length; i++) {
        const price = row.cells[i]
        if (price == null) continue
        const product = (cols[i] ?? '').trim()
        if (!product) continue
        const key = `${t.section}|${product}|${row.code}`
        if (seen.has(key)) { warnings.push(`Дубль строки прайса: ${key}`); continue }
        seen.add(key)
        items.push({
          section: t.section,
          product,
          variantCode: row.code,
          thicknessMm: row.thicknessMm,
          sheetFormat: row.sheetFormat,
          pricePerM2: price,
          note: row.note,
          sortOrder: sortOrder++,
        })
      }
    }
  }
  return items
}
