// Догон ДДС из книги владельца (листы «ИП ДДС» / «ООО ДДС») в cashflow_entries.
// Книга широкая: колонки — дни (дд.мм, год выводится по переходу декабрь→январь
// от 01.06.2024), строки — фонды (со своим итогом в колонке C) и подфонды под ними.
// Правила разбора те же, что у первого импорта (docs/DDS_IMPORT_REPORT.md):
//   1. Импортируются строки подфондов; если дневная сумма фонда больше суммы его
//      подфондов, разница идёт отдельной записью на сам фонд (прямой ввод) — кроме
//      разницы, равной следующему фонду целиком: это захват соседнего блока формулой
//      итога (так «Реклама и продвижение» ИП с 06.2025 включает «Партнерские»).
//      У фондов из OWN_ROW_FUNDS строка фонда — свой ввод: берётся целиком, подстроки
//      прибавляются к ней, а не вычитаются из неё.
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
import { loadEnvLocal } from './lib/envLocal.mjs'
import { parseCsv, dateColumns, buildLayout, collectEntries, round2 } from './lib/ddsBookParse.mjs'

const env = loadEnvLocal()
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const SHEET_ID = arg('sheet', '1QL9x9qqH8iHmNNKV1nVm7IVfhl5mMyEwqe3xKRyNqWw')
const FROM = arg('from', '')
const TO = arg('to', '')
const DRY = has('dry')
const REPLACE = has('replace')
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

async function fetchTab(tab) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Лист «${tab}»: HTTP ${r.status} — книга должна быть доступна по ссылке`)
  return parseCsv(await r.text())
}

async function collect(unit, tab) {
  const [{ data: funds }, { data: subs }] = await Promise.all([
    sb.from('cashflow_funds').select('id,name,fund_class,sort').eq('unit', unit).order('sort'),
    sb.from('cashflow_subfunds').select('id,fund_id,name'),
  ])
  const rows = await fetchTab(tab)
  const cols = dateColumns(rows[0] ?? []).filter(c => c.date >= FROM && c.date <= TO)
  if (!cols.length) throw new Error(`Лист «${tab}»: в диапазоне ${FROM}…${TO} нет колонок`)
  const { layout, unknown } = buildLayout(rows, funds, subs)
  return { ...collectEntries({ unit, rows, cols, layout }), unknown }
}

// --- запуск ------------------------------------------------------------
const all = []
for (const { unit, tab } of TABS) {
  const { entries, unknown, skipped, warnings } = await collect(unit, tab)
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
  if (skipped.length) {
    const sum = skipped.reduce((s, x) => s + x.amount, 0)
    console.log(`  пропущено как захват соседнего фонда: ${skipped.length} дн., ${fmt(sum)}`)
    for (const x of skipped) console.log(`    ${x.date} ${x.fund} − подстроки = ${fmt(x.amount)} = «${x.neighbour}» за день`)
  }
  for (const w of warnings)
    console.log(`  ⚠️  ${w.date} ${w.fund}: разница ${fmt(w.amount)} больше блока «${w.neighbour}» ${fmt(w.neighbourBlock)} — проверить в книге`)
}

function fmt(n) { return Math.round(n).toLocaleString('ru-RU') + ' ₽' }

const batches = [...new Set(all.map(e => e.import_batch))]

// --compare: книга против того, что уже лежит в базе за тот же период (ничего не пишет)
if (has('compare')) {
  // постранично: без range() PostgREST отдаёт первые 1000 строк, и длинный период молча обрезается
  const db = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('cashflow_entries')
      .select('unit,kind,fund_id,subfund_id,amount').gte('entry_date', FROM).lte('entry_date', TO)
      .order('id').range(from, from + 999)
    if (error) { console.error('Не удалось прочитать базу:', error.message); process.exit(1) }
    db.push(...data)
    if (data.length < 1000) break
  }
  const key = (e) => `${e.unit}|${e.fund_id}|${e.subfund_id ?? 0}|${e.kind}`
  const roll = (rows) => rows.reduce((m, e) => m.set(key(e), (m.get(key(e)) ?? 0) + Number(e.amount)), new Map())
  const book = roll(all), base = roll(db)
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
