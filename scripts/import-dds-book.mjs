// Догон ДДС из книги владельца (листы «ИП ДДС» / «ООО ДДС») в cashflow_entries.
// Книга широкая: колонки — дни (дд.мм, год выводится по переходу декабрь→январь
// от 01.06.2024), строки — фонды (со своим итогом в колонке C) и подфонды под ними.
// Правила разбора те же, что у первого импорта (docs/DDS_IMPORT_REPORT.md):
//   1. Импортируются строки подфондов; если дневная сумма фонда больше суммы его
//      подфондов, разница идёт отдельной записью на сам фонд (прямой ввод).
//   2. Отрицательная сумма = сторно: направление переворачивается, сумма по модулю.
//   3. Подфонд «возвраты» внутри поступлений — это расход.
//   4. Служебные строки (остатки, «Совокупно», «ПОТРАЧЕНО…») не операции — пропускаются.
// Партия = dds_book_<ГГГГ-ММ> на каждый месяц: повторный запуск требует --replace,
// который удаляет ТОЛЬКО строки этой партии.
//
// Запуск из mglass-app:
//   node scripts/import-dds-book.mjs --from 2026-07-01 --to 2026-08-25 --dry
//   node scripts/import-dds-book.mjs --from 2026-07-01 --to 2026-08-25
//   node scripts/import-dds-book.mjs --from 2026-07-01 --to 2026-08-25 --replace

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const SHEET_ID = arg('sheet', '1QL9x9qqH8iHmNNKV1nVm7IVfhl5mMyEwqe3xKRyNqWw')
const FROM = arg('from', '')
const TO = arg('to', '')
const DRY = has('dry')
const REPLACE = has('replace')
const BOOK_START_YEAR = 2024   // первая колонка книги — 01.06.2024
const TABS = [{ unit: 'ip', tab: 'ИП ДДС' }, { unit: 'ooo', tab: 'ООО ДДС' }]

function arg(name, def) {
  const i = process.argv.indexOf('--' + name)
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def
}
function has(name) { return process.argv.includes('--' + name) }

if (!/^\d{4}-\d{2}-\d{2}$/.test(FROM) || !/^\d{4}-\d{2}-\d{2}$/.test(TO)) {
  console.error('Нужны --from и --to в формате ГГГГ-ММ-ДД')
  process.exit(1)
}

// --- CSV ---------------------------------------------------------------
function parseCsv(text) {
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

async function fetchTab(tab) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Лист «${tab}»: HTTP ${r.status} — книга должна быть доступна по ссылке`)
  return parseCsv(await r.text())
}

// Колонки-дни: год наращивается на переходе через январь.
function dateColumns(header) {
  const cols = []
  let year = BOOK_START_YEAR, prevMonth = null
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

const num = (raw) => {
  const s = (raw ?? '').replace(/ |\s|₽/g, '').replace(',', '.')
  if (!s || s === '-') return 0
  const v = Number(s)
  return Number.isFinite(v) ? v : 0
}
const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase()

// --- сборка операций ---------------------------------------------------
async function collect(unit, tab) {
  const [{ data: funds }, { data: subs }] = await Promise.all([
    sb.from('cashflow_funds').select('id,name,fund_class,sort').eq('unit', unit).order('sort'),
    sb.from('cashflow_subfunds').select('id,fund_id,name'),
  ])
  const fundByName = new Map(funds.map(f => [norm(f.name), f]))
  const subsByFund = new Map()
  for (const s of subs) {
    if (!subsByFund.has(s.fund_id)) subsByFund.set(s.fund_id, new Map())
    subsByFund.get(s.fund_id).set(norm(s.name), s)
  }

  const rows = await fetchTab(tab)
  const cols = dateColumns(rows[0] ?? []).filter(c => c.date >= FROM && c.date <= TO)
  if (!cols.length) throw new Error(`Лист «${tab}»: в диапазоне ${FROM}…${TO} нет колонок`)

  // Разметка строк: фонд (есть свой итог в колонке C) → его подфонды ниже.
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

  const entries = []
  const unknown = new Set()
  rows.forEach((r, ri) => {
    const name = (r[0] ?? '').trim()
    if (name && !layout.some(l => l.ri === ri) && (r[2] ?? '').trim() !== '') unknown.add(name)
  })

  for (const { i, date } of cols) {
    for (const line of layout.filter(l => !l.sub)) {
      const fund = line.fund
      const fundVal = num(rows[line.ri]?.[i])
      const subLines = layout.filter(l => l.fund?.id === fund.id && l.sub)
      let subSum = 0
      for (const sl of subLines) {
        const v = num(rows[sl.ri]?.[i])
        if (!v) continue
        subSum += v
        entries.push(makeEntry(unit, date, fund, sl.sub, v))
      }
      // Строка фонда больше суммы подфондов → разница внесена напрямую на фонд.
      // Меньше — это не сторно, а недобор формулы SUM в книге (docs/DDS_IMPORT_REPORT.md):
      // детальные строки уже импортированы, добавлять отрицательную разницу нельзя.
      const direct = subLines.length ? round2(fundVal - subSum) : fundVal
      const meaningful = subLines.length ? direct >= 0.01 : Math.abs(direct) >= 0.01
      if (meaningful) entries.push(makeEntry(unit, date, fund, null, direct))
    }
  }
  return { entries, unknown: [...unknown] }
}

const round2 = (v) => Math.round(v * 100) / 100

function makeEntry(unit, date, fund, sub, value) {
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

// --- запуск ------------------------------------------------------------
const all = []
for (const { unit, tab } of TABS) {
  const { entries, unknown } = await collect(unit, tab)
  all.push(...entries)
  const byMonth = {}
  for (const e of entries) {
    const k = e.import_batch.replace('dds_book_', '')
    byMonth[k] ??= { n: 0, in: 0, out: 0 }
    byMonth[k].n++
    byMonth[k][e.kind] += Number(e.amount)
  }
  console.log(`\n=== ${tab} (${unit}) ===`)
  for (const [m, v] of Object.entries(byMonth).sort())
    console.log(`  ${m}: ${v.n} операций, приход ${fmt(v.in)}, расход ${fmt(v.out)}`)
  if (unknown.length) console.log(`  ⚠️  строки с итогом, не найденные в справочнике фондов: ${unknown.join(', ')}`)
}

function fmt(n) { return Math.round(n).toLocaleString('ru-RU') + ' ₽' }

const batches = [...new Set(all.map(e => e.import_batch))]

// --compare: книга против того, что уже лежит в базе за тот же период (ничего не пишет)
if (has('compare')) {
  const { data: db } = await sb.from('cashflow_entries')
    .select('unit,kind,fund_id,subfund_id,amount').gte('entry_date', FROM).lte('entry_date', TO)
  const key = (e) => `${e.unit}|${e.fund_id}|${e.subfund_id ?? 0}|${e.kind}`
  const roll = (rows) => rows.reduce((m, e) => m.set(key(e), (m.get(key(e)) ?? 0) + Number(e.amount)), new Map())
  const book = roll(all), base = roll(db ?? [])
  const names = new Map()
  for (const unit of ['ip', 'ooo']) {
    const [{ data: f }, { data: s }] = await Promise.all([
      sb.from('cashflow_funds').select('id,name').eq('unit', unit),
      sb.from('cashflow_subfunds').select('id,name'),
    ])
    f.forEach(x => names.set('f' + x.id, x.name))
    s.forEach(x => names.set('s' + x.id, x.name))
  }
  console.log('\n=== книга vs база, ' + FROM + '…' + TO + ' ===')
  let same = 0
  for (const k of new Set([...book.keys(), ...base.keys()].sort())) {
    const b = round2(book.get(k) ?? 0), d = round2(base.get(k) ?? 0)
    if (Math.abs(b - d) < 0.5) { same++; continue }
    const [unit, fid, sid, kind] = k.split('|')
    const label = names.get('f' + fid) + (sid !== '0' ? ' → ' + names.get('s' + sid) : '')
    console.log(`  ${unit} ${kind} ${label}: книга ${fmt(b)} / база ${fmt(d)} / разница ${fmt(b - d)}`)
  }
  console.log(`  совпало строк: ${same}`)
  process.exit(0)
}

const { data: existing } = await sb.from('cashflow_entries').select('import_batch').in('import_batch', batches).limit(1)

if (DRY) {
  console.log(`\nDRY-RUN: всего ${all.length} операций, партии ${batches.join(', ')}. Ничего не записано.`)
  process.exit(0)
}
if (existing?.length && !REPLACE) {
  console.error(`\nПартии ${batches.join(', ')} уже есть в базе. Повтор — только с --replace (удалит строки этих партий).`)
  process.exit(1)
}
if (REPLACE) {
  const { error, count } = await sb.from('cashflow_entries').delete({ count: 'exact' }).in('import_batch', batches)
  if (error) { console.error('Не удалось очистить партии:', error.message); process.exit(1) }
  console.log(`\nУдалено строк прошлой партии: ${count ?? 0}`)
}

for (let i = 0; i < all.length; i += 500) {
  const chunk = all.slice(i, i + 500)
  const { error } = await sb.from('cashflow_entries').insert(chunk)
  if (error) { console.error('Ошибка вставки:', error.message); process.exit(1) }
  process.stdout.write(`\rЗаписано ${Math.min(i + 500, all.length)} / ${all.length}`)
}
console.log(`\nГотово: ${all.length} операций, партии ${batches.join(', ')}`)
