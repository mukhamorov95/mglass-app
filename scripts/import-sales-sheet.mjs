// Ручной запуск синхронизации книги «Продажи Мгласс» → crm_sales («Реестр продаж
// и оплат»). Каждое утро в 8:00 МСК то же самое делает крон
// /api/cron/sales-sheet-sync — код один: lib/sales/salesSheetSync.ts.
//
// Книга — источник правды. Строки сопоставляются по номеру заказа (номер строки
// в книге плывёт при вставке), новые добавляются, исправленные обновляются,
// пропавшие из книги гасятся (voided), а не удаляются.
//
// Запуск из mglass-app:
//   node scripts/import-sales-sheet.mjs --dry                 # все месячные вкладки
//   node scripts/import-sales-sheet.mjs --tabs "Август 26"
//   node scripts/import-sales-sheet.mjs --since 2026-07
//   --no-amo — не спрашивать тип изделия у AmoCRM

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

// Ядро — TypeScript, Node 24 грузит его сам. Его предупреждение «тип модуля не
// указан» к делу не относится и забивает вывод — глушим до загрузки.
process.removeAllListeners('warning')
const { syncSalesBook, formatSyncReport } = await import('../lib/sales/salesSheetSync.ts')

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
// Тип изделия из amo — тот же GET-клиент, что у крона; он читает ключи из process.env.
for (const k of ['AMO_SUBDOMAIN', 'AMO_ACCESS_TOKEN']) if (env[k]) process.env[k] = env[k]
const { amoGet } = await import('../lib/amocrm.ts')

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d }
const has = n => process.argv.includes('--' + n)

const report = await syncSalesBook(sb, {
  dry: has('dry'),
  only: arg('tabs', '').split(',').map(s => s.trim()).filter(Boolean),
  since: arg('since', ''),
  amoGet: has('no-amo') ? undefined : (path, params) => amoGet(path, params),
})
console.log(formatSyncReport(report).replace(/<\/?b>/g, ''))
if (report.error) process.exit(1)
