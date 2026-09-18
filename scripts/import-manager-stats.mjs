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

const { facts, monthly, unknown, days } = parseManagerStats(parseCsv(await res.text()))
const rows = SINCE ? facts.filter(f => f.stat_date >= SINCE) : facts
const months = SINCE ? monthly.filter(m => m.month >= SINCE.slice(0, 7)) : monthly

console.log(`Дней в листе: ${days}. Дневных фактов: ${facts.length}, помесячных итогов: ${monthly.length}${SINCE ? ` (после ${SINCE}: ${rows.length} / ${months.length})` : ''}${DRY ? '  (сухой прогон)' : ''}`)
if (unknown.length) console.log(`Не опознаны как менеджеры (в базу не пошли): ${unknown.join(' · ')}`)

if (!DRY) {
  const now = new Date().toISOString()
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from('manager_stats_daily')
      .upsert(rows.slice(i, i + 500).map(r => ({ ...r, source: 'gsheet_mgmt', updated_at: now })),
        { onConflict: 'stat_date,manager,metric' })
    if (error) { console.error('ошибка записи дней:', error.message); process.exit(1) }
  }
  const monthRows = months.map(m => ({
    month: m.month, manager: m.manager, metric: m.metric, book: m.book, days: m.days,
    value: m.value, kind: m.kind, delta: m.delta, note_day: m.day ?? null, updated_at: now,
  }))
  for (let i = 0; i < monthRows.length; i += 500) {
    const { error } = await sb.from('manager_stats_monthly')
      .upsert(monthRows.slice(i, i + 500), { onConflict: 'month,manager,metric' })
    if (error) { console.error('ошибка записи месяцев:', error.message); process.exit(1) }
  }
}

// Сверка «итог месяца в книге ↔ сумма дней». Молча выбирать одну из цифр нельзя:
// где они расходятся, печатаем, кто прав и почему.
const label = Object.fromEntries(METRICS.map(m => [m.key, m.label]))
const fmtv = (k, v) => (MONEY_METRICS.has(k) ? rub(v) : Math.round(v).toLocaleString('ru-RU'))
const odd = months.filter(m => m.kind !== 'match' && !(m.kind === 'no_total' && !m.days))
console.log(`\nСверка итог месяца ↔ сумма дней: расхождений ${odd.length}`)
for (const m of odd) {
  const why = m.kind === 'month_only' ? 'внесено только в итог месяца — берём итог'
    : m.kind === 'total_misses_last_day' ? `итог в книге не включает ${m.day} — берём дни, книгу поправить`
    : m.kind === 'no_total' ? 'итог месяца в книге пустой, а дни заполнены — берём дни, книгу проверить'
    : 'итог меньше суммы дней — берём дни, книгу проверить'
  console.log(`  ${m.month} ${m.manager.padEnd(10)} ${label[m.metric].padEnd(16)} книга ${fmtv(m.metric, m.book ?? 0)} · дни ${fmtv(m.metric, m.days)} → ${why}`)
}

// Итог по месяцам — то, что увидит экран, в том же виде, что колонка книги.
const byMonth = new Map()
for (const m of months) {
  const cur = byMonth.get(m.month) ?? {}
  cur[m.metric] = (cur[m.metric] ?? 0) + m.value
  byMonth.set(m.month, cur)
}
console.log('\nПо месяцам (как покажет экран):')
for (const [mo, v] of [...byMonth.entries()].sort().slice(-12)) {
  const parts = METRICS.map(k => `${k.label} ${fmtv(k.key, v[k.key] ?? 0)}`)
  console.log(`  ${mo}: ${parts.join(' · ')}`)
}
