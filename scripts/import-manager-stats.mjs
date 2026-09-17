// Показатели менеджеров из управленческой книги владельца в manager_stats_daily.
//
// Лист «Аналитика дохода» книги «Управленческая таблица M-Glass»: разговоры,
// замеры назначенные и проведённые, количество оплат и полученные деньги —
// по дням и по менеджерам. Владелец ведёт её постоянно, поэтому скрипт
// повторяемый: ключ день+менеджер+показатель, повторный запуск обновляет.
//
// Запуск из mglass-app:
//   node scripts/import-manager-stats.mjs --dry
//   node scripts/import-manager-stats.mjs --since 2026-01-01

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { parseManagerStats, METRICS, MONEY_METRICS } from './lib/managerStatsParse.mjs'
import { BOOKS } from './lib/books.mjs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d }
const has = n => process.argv.includes('--' + n)
const DRY = has('dry')
const SINCE = arg('since', '')
const rub = n => Math.round(n).toLocaleString('ru-RU') + ' ₽'

// gviz отдаёт лист как CSV — здесь цвета не нужны, нужны только числа.
function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else quoted = false } else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (ch !== '\r') cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}

const book = BOOKS.management
const url = `https://docs.google.com/spreadsheets/d/${book.id}/gviz/tq?tqx=out:csv&gid=${book.tabs.income}`
const res = await fetch(url)
if (!res.ok) { console.error(`Лист недоступен: HTTP ${res.status}`); process.exit(1) }

const { facts, unknown, days } = parseManagerStats(parseCsv(await res.text()))
const rows = SINCE ? facts.filter(f => f.stat_date >= SINCE) : facts

console.log(`Дней в листе: ${days}. Фактов: ${facts.length}${SINCE ? `, после ${SINCE}: ${rows.length}` : ''}${DRY ? '  (сухой прогон)' : ''}`)
if (unknown.length) console.log(`Не опознаны как менеджеры (в базу не пошли): ${unknown.join(' · ')}`)

if (!DRY && rows.length) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from('manager_stats_daily')
      .upsert(rows.slice(i, i + 500).map(r => ({ ...r, source: 'gsheet_mgmt', updated_at: new Date().toISOString() })),
        { onConflict: 'stat_date,manager,metric' })
    if (error) { console.error('ошибка записи:', error.message); process.exit(1) }
  }
}

// Итог по месяцам — чтобы было видно, что загрузилось, а не «ок».
const byMonth = new Map()
for (const f of rows) {
  const k = f.stat_date.slice(0, 7)
  const cur = byMonth.get(k) ?? {}
  cur[f.metric] = (cur[f.metric] ?? 0) + f.value
  byMonth.set(k, cur)
}
console.log('\nПо месяцам (сумма по всем менеджерам):')
for (const [m, v] of [...byMonth.entries()].sort().slice(-12)) {
  const parts = METRICS.map(k => `${k.label} ${MONEY_METRICS.has(k.key) ? rub(v[k.key] ?? 0) : Math.round(v[k.key] ?? 0)}`)
  console.log(`  ${m}: ${parts.join(' · ')}`)
}
