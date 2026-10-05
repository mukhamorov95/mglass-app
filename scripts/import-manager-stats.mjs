// Показатели менеджеров из управленческой книги владельца в manager_stats_daily.
//
// Лист «Аналитика дохода» книги «Управленческая таблица M-Glass»: разговоры,
// замеры назначенные и проведённые, количество оплат и полученные деньги —
// по дням и по менеджерам. Каждое утро в 8:05 МСК то же делает крон
// /api/cron/manager-stats-sync — код один: lib/sales/managerStatsSync.ts.
// Значение, стёртое в книге, в базе становится 0.
//
// Запуск из mglass-app:
//   node scripts/import-manager-stats.mjs --dry
//   node scripts/import-manager-stats.mjs --since 2026-01-01   # без --since — вся книга

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

// Ядро — TypeScript, Node 24 грузит его сам; предупреждение о типе модуля глушим.
process.removeAllListeners('warning')
const { syncManagerStats, formatManagerStatsReport } = await import('../lib/sales/managerStatsSync.ts')

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d }
const has = n => process.argv.includes('--' + n)
const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10)

const r = await syncManagerStats(sb, { dry: has('dry'), since: arg('since', '2000-01-01'), today })
console.log(`С ${r.since}: дневных значений ${r.facts}, помесячных итогов ${r.months}${r.dry ? '  (сухой прогон)' : ''}`)
console.log(`Стёрто в книге → 0 в базе: дней ${r.zeroed.days}, месяцев ${r.zeroed.months}`)
console.log(`Книга заполнена по ${r.lastDay ?? '—'}: ${Object.entries(r.lastDayByManager).map(([m, d]) => `${m} ${d}`).join(' · ')}`)
console.log(`Итог месяца ≠ сумма дней: ${r.odd.length}`)
for (const m of r.odd) console.log(`  ${m.month} ${m.manager} ${m.metric}: книга ${m.book ?? '—'} · дни ${m.days} → ${m.kind}`)
const text = formatManagerStatsReport(r, today)
if (text) console.log('\n' + text.replace(/<\/?b>/g, ''))
if (r.error || r.held) process.exit(1)
