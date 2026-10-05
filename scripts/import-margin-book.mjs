// Ручной запуск сверки книги «Маржа» с «Продажами Мгласс». Каждое утро в 8:10 МСК
// то же делает крон /api/cron/margin-book-sync — код один: lib/sales/marginBook.ts.
//
// Запуск из mglass-app:
//   node scripts/import-margin-book.mjs --dry              # с января 2026, без записи
//   node scripts/import-margin-book.mjs --since 2025-04    # вся книга
//   node scripts/import-margin-book.mjs --dry --objects    # плюс каждый объект

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

// Ядро — TypeScript, Node 24 грузит его сам; предупреждение о типе модуля глушим.
process.removeAllListeners('warning')
const { syncMarginBook, formatMarginReport, monthRu } = await import('../lib/sales/marginBook.ts')

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d }
const has = n => process.argv.includes('--' + n)

const report = await syncMarginBook(sb, { dry: has('dry'), since: arg('since', undefined) })
console.log(formatMarginReport(report, 100_000).replace(/<\/?b>/g, ''))
if (has('objects')) {
  for (const m of report.months) {
    console.log(`\n${monthRu(m.month)}`)
    for (const o of m.objects) {
      const md = o.md == null ? '—' : `${Math.round(o.md)} (${o.md_pct?.toFixed(1)}%)`
      console.log(`  ${o.order_no ?? '—'}\t${o.closed ? 'закрыт' : 'открыт'}\t${Math.round(o.amount)}\tМД ${md}\t${o.precise ? 'точно' : o.issues.map(i => i.kind).join(',')}`)
    }
  }
}
if (report.error) process.exit(1)
