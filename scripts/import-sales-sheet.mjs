// Догон продаж из книги владельца «Продажи Мгласс» в crm_sales.
//
// Первый импорт (docs/SALES_IMPORT_REPORT.md) был разовой выгрузкой от 20.07.2026:
// июль вошёл наполовину, августа и сентября в системе нет вовсе — экран «Реестр
// продаж» за сентябрь пустой. Этот скрипт повторяемый: ключ строки — её номер в
// книге (gsheet:<вкладка>:<строка>), поэтому повторный запуск обновляет, а не дублирует.
//
// Запуск из mglass-app:
//   node scripts/import-sales-sheet.mjs --dry                 # все месячные вкладки
//   node scripts/import-sales-sheet.mjs --tabs "Август 26"
//   node scripts/import-sales-sheet.mjs --since 2026-07

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { parseTab, parseTabList, parseTabMonth } from './lib/salesSheetParse.mjs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d }
const has = n => process.argv.includes('--' + n)

const SHEET_ID = arg('sheet', '15FavFbEdA_G33k_4ExsuPYF4Xf_eezmGC64OTsTY9vw')
const BATCH = 'gsheet_sales_v2'   // та же партия, что у первого импорта
const DRY = has('dry')
const ONLY = arg('tabs', '').split(',').map(s => s.trim()).filter(Boolean)
const SINCE = arg('since', '')
const rub = n => Math.round(n).toLocaleString('ru-RU') + ' ₽'

async function fetchText(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`HTTP ${r.status} — книга должна быть доступна по ссылке`)
  return r.text()
}

const book = await fetchText(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/htmlview`)
const tabs = parseTabList(book)
  .filter(t => parseTabMonth(t.name))
  .filter(t => (ONLY.length ? ONLY.includes(t.name.trim()) : true))
  .filter(t => (SINCE ? parseTabMonth(t.name) >= SINCE : true))

if (tabs.length === 0) { console.error('Месячных вкладок не найдено'); process.exit(1) }
console.log(`Вкладки: ${tabs.map(t => t.name.trim()).join(', ')}${DRY ? '  (сухой прогон)' : ''}\n`)

let totalIns = 0, totalUpd = 0
for (const tab of tabs) {
  const name = tab.name.trim()
  const html = await fetchText(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/htmlview/sheet?headers=true&gid=${tab.gid}`)
  const { ledgerMonth, sales, skipped } = parseTab(html, tab.gid, name)
  const sum = sales.reduce((s, r) => s + r.amount, 0)

  const { data: existing } = await sb.from('crm_sales')
    .select('id, external_key, amount').eq('import_batch', BATCH).eq('ledger_month', ledgerMonth)
  const byKey = new Map((existing ?? []).map(r => [r.external_key, r]))
  const insert = sales.filter(s => !byKey.has(s.external_key))
  const update = sales.filter(s => byKey.has(s.external_key))
  // Строки, которые есть в системе, но пропали из книги: не удаляем молча — показываем.
  const keys = new Set(sales.map(s => s.external_key))
  const orphans = (existing ?? []).filter(r => !keys.has(r.external_key))

  console.log(`${name} (${ledgerMonth}): в книге ${sales.length} на ${rub(sum)} · новых ${insert.length} · обновить ${update.length}${orphans.length ? ` · в системе лишних ${orphans.length}` : ''}`)
  if (skipped.length) {
    const sk = skipped.reduce((s, r) => s + r.prepayment, 0)
    console.log(`  доплат без «Суммы заказа»: ${skipped.length} на ${rub(sk)} — книга их в итог месяца не берёт:`)
    for (const r of skipped) console.log(`    строка ${r.row}: ${r.order_no ?? '—'} ${r.client ?? ''} ${rub(r.prepayment)}`)
  }
  const review = sales.filter(s => s.needs_review)
  if (review.length) console.log(`  без даты продажи (месяц по вкладке, помечены на проверку): ${review.map(r => r.order_no).join(', ')}`)

  if (!DRY && sales.length) {
    const rows = sales.map(({ skip, ...s }) => ({ ...s, source: 'import_gsheet', import_batch: BATCH, created_by: 'Импорт книги' }))
    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await sb.from('crm_sales')
        .upsert(rows.slice(i, i + 100), { onConflict: 'external_key' })
      if (error) { console.error('  ошибка записи:', error.message); process.exit(1) }
    }
  }
  totalIns += insert.length; totalUpd += update.length
}

// Сверка с самой книгой: её строка «Продаж за месяц» против суммы в системе.
console.log('\nСверка помесячно (система против книги):')
const mglass = await fetchText(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=1728905654`)
const bookByMonth = new Map()
for (const line of mglass.split('\n')) {
  const cells = line.split('","').map(c => c.replace(/^"|"$/g, ''))
  if (!/^\d{4}$/.test(cells[0])) continue
  cells.slice(1, 13).forEach((v, i) => {
    const n = Number(String(v).replace(/р\.| |\s/g, ''))
    if (Number.isFinite(n) && n > 0) bookByMonth.set(`${cells[0]}-${String(i + 1).padStart(2, '0')}`, n)
  })
}
for (const tab of tabs) {
  const ym = parseTabMonth(tab.name)
  const { data } = await sb.from('crm_sales').select('amount')
    .eq('ledger_month', ym).eq('department', 'mglass').eq('voided', false)
  const sys = (data ?? []).reduce((s, r) => s + Number(r.amount || 0), 0)
  const bk = bookByMonth.get(ym) ?? 0
  const diff = Math.round(sys - bk)
  console.log(`  ${ym}: система ${rub(sys)} · книга ${rub(bk)} · ${diff === 0 ? 'сходится' : `расхождение ${rub(diff)}`}`)
}
console.log(`\nИтого: новых ${totalIns}, обновлено ${totalUpd}${DRY ? ' (ничего не записано — сухой прогон)' : ''}`)
