// Разбор книги ДДС (листы «ИП ДДС» / «ООО ДДС») в операции cashflow_entries.
// Здесь только чистая логика — без сети и базы, чтобы её можно было проверить тестом
// (__tests__/cfo/ddsBookParse.test.ts). Правила — docs/DDS_IMPORT_REPORT.md.

export const BOOK_START_YEAR = 2024   // первая колонка книги — 01.06.2024

// Фонды, у которых строка фонда — собственный ввод, а не итог подстрок: подстроки
// прибавляются к ней. У «Партнерских» ИП это видно по дням, где «СММ» 10 000, а сама
// строка пустая, и по итогу «Реклама и продвижение», который складывает обе.
export const OWN_ROW_FUNDS = { ip: ['партнерские'] }

export function parseCsv(text) {
  const rows = []
  let row = [], cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else quoted = false }
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (ch !== '\r') cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}

// Колонки-дни: год наращивается на переходе через январь.
export function dateColumns(header, startYear = BOOK_START_YEAR) {
  const cols = []
  let year = startYear, prevMonth = null
  header.forEach((raw, i) => {
    const m = /^(\d{2})\.(\d{2})$/.exec((raw ?? '').trim())
    if (!m) return
    const day = Number(m[1]), month = Number(m[2])
    if (prevMonth !== null && month < prevMonth) year++
    prevMonth = month
    cols.push({ i, date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` })
  })
  return cols
}

export const num = (raw) => {
  const s = (raw ?? '').replace(/ |\s|₽/g, '').replace(',', '.')
  if (!s || s === '-') return 0
  const v = Number(s)
  return Number.isFinite(v) ? v : 0
}
export const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
export const round2 = (v) => Math.round(v * 100) / 100

// Разметка строк: фонд (есть свой итог в колонке C) → его подфонды ниже.
// funds — cashflow_funds юнита по sort, subs — cashflow_subfunds.
export function buildLayout(rows, funds, subs) {
  const fundByName = new Map(funds.map(f => [norm(f.name), f]))
  const subsByFund = new Map()
  for (const s of subs) {
    if (!subsByFund.has(s.fund_id)) subsByFund.set(s.fund_id, new Map())
    subsByFund.get(s.fund_id).set(norm(s.name), s)
  }
  const layout = []
  let current = null
  rows.forEach((r, ri) => {
    if (ri === 0) return
    const name = norm(r[0])
    if (!name) return
    const hasTotal = (r[2] ?? '').trim() !== ''
    const asFund = fundByName.get(name)
    const asSub = current ? subsByFund.get(current.id)?.get(name) : null
    if (asFund && (hasTotal || !asSub)) { current = asFund; layout.push({ ri, fund: asFund, sub: null }) }
    else if (asSub) layout.push({ ri, fund: current, sub: asSub })
    // остальное — служебные строки книги, не операции
  })
  const unknown = []
  rows.forEach((r, ri) => {
    const name = (r[0] ?? '').trim()
    if (ri && name && !layout.some(l => l.ri === ri) && (r[2] ?? '').trim() !== '') unknown.push(name)
  })
  return { layout, unknown: [...new Set(unknown)] }
}

// Операции за выбранные колонки-дни.
// skipped — разницы «итог фонда минус подстроки», которые целиком объяснены соседним
// фондом: формула итога захватила следующий блок, его деньги уже импортированы у него.
// warnings — разница больше соседнего блока: возможен захват плюс настоящий ввод, смотреть руками.
export function collectEntries({ unit, rows, cols, layout }) {
  const heads = layout.filter(l => !l.sub)
  const ownRow = new Set(OWN_ROW_FUNDS[unit] ?? [])
  const entries = [], skipped = [], warnings = []
  for (const { i, date } of cols) {
    const cell = (ri) => num(rows[ri]?.[i])
    heads.forEach((line, k) => {
      const fund = line.fund
      const fundVal = cell(line.ri)
      const subLines = layout.filter(l => l.fund?.id === fund.id && l.sub)
      let subSum = 0
      for (const sl of subLines) {
        const v = cell(sl.ri)
        if (!v) continue
        subSum += v
        entries.push(makeEntry(unit, date, fund, sl.sub, v))
      }
      if (!subLines.length || ownRow.has(norm(fund.name))) {
        if (Math.abs(fundVal) >= 0.01) entries.push(makeEntry(unit, date, fund, null, fundVal))
        return
      }
      // Строка фонда больше суммы подфондов → разница внесена напрямую на фонд.
      // Меньше — это не сторно, а недобор формулы SUM в книге: детальные строки уже
      // импортированы, добавлять отрицательную разницу нельзя.
      const direct = round2(fundVal - subSum)
      if (direct < 0.01) return
      const next = heads[k + 1]
      const nextBlock = next
        ? round2(layout.filter(l => l.fund?.id === next.fund.id).reduce((s, l) => s + cell(l.ri), 0))
        : 0
      if (nextBlock >= 0.01 && Math.abs(direct - nextBlock) < 0.01) {
        skipped.push({ date, fund: fund.name, neighbour: next.fund.name, amount: direct })
        return
      }
      if (nextBlock >= 0.01 && direct > nextBlock) {
        warnings.push({ date, fund: fund.name, neighbour: next.fund.name, amount: direct, neighbourBlock: nextBlock })
      }
      entries.push(makeEntry(unit, date, fund, null, direct))
    })
  }
  return { entries, skipped, warnings }
}

export function makeEntry(unit, date, fund, sub, value) {
  // возвраты внутри поступлений — это расход; минус — сторно (переворот направления)
  let kind = fund.fund_class === 'income' ? 'in' : 'out'
  if (sub && norm(sub.name) === 'возвраты') kind = 'out'
  if (value < 0) kind = kind === 'in' ? 'out' : 'in'
  return {
    entry_date: date, unit, kind, fund_id: fund.id, subfund_id: sub?.id ?? null,
    amount: round2(Math.abs(value)),
    entered_by_name: 'Импорт ДДС', import_batch: `dds_book_${date.slice(0, 7)}`,
  }
}
