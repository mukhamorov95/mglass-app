// Бэкфилл типа изделия розничных продаж (crm_sales.product_type) с июня 2025:
// книга «Продажи Мгласс» с июня 2025 графы «изделие» не ведёт, и 604 из 605 строк пусты.
// Правило одно с писателями — lib/sales/retailProductType.mjs.
// Источники по приоритету: связанный расчёт → договор (номер = номер заказа) →
// сделка amo («Тип изделия», затем название) → текст продажи/лида. AmoCRM — только GET.
//
// Запуск из mglass-app:
//   node scripts/backfill-retail-product-type.mjs                 # сухой прогон (по умолчанию)
//   node scripts/backfill-retail-product-type.mjs --check-old     # плюс сверка amo с графой книги до июня 2025
//   node scripts/backfill-retail-product-type.mjs --apply         # запись, только в пустые product_type
//   --since 2025-06-01 · --env /путь/.env.local

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

process.removeAllListeners('warning')
const R = await import('../lib/sales/retailProductType.mjs')

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d }
const has = n => process.argv.includes('--' + n)
const APPLY = has('apply')
const SINCE = arg('since', '2025-06-01')

const envPath = arg('env', new URL('../.env.local', import.meta.url).pathname)
const env = Object.fromEntries(readFileSync(envPath, 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const sub = String(env.AMO_SUBDOMAIN ?? '')
const amoHost = sub.includes('.') ? sub : `${sub}.amocrm.ru`
const sleep = ms => new Promise(r => setTimeout(r, ms))
// Только чтение: метод GET зашит, токен не обновляем.
async function amoGet(path, params) {
  const u = new URL(`https://${amoHost}/api/v4${path}`)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  for (let attempt = 0; ; attempt++) {
    // Обрыв соединения бывает разовым — повтор, как в lib/amocrm.ts.
    const r = await fetch(u, { method: 'GET', headers: { Authorization: `Bearer ${env.AMO_ACCESS_TOKEN}` } })
      .catch(e => { if (e instanceof TypeError && attempt < 4) return null; throw e })
    if (!r || (r.status === 429 && attempt < 4)) { await sleep(1000 * (attempt + 1)); continue }
    if (r.status === 204) return null
    if (!r.ok) throw new Error(`AmoCRM GET ${path} → ${r.status}`)
    await sleep(180)   // amo пускает 7 запросов в секунду
    return r.json()
  }
}

async function pageAll(build) {
  const out = []
  for (let from = 0; ; from += 500) {
    const { data, error } = await build().order('id', { ascending: true }).range(from, from + 499)
    if (error) throw new Error(error.message)
    out.push(...data)
    if (data.length < 500) return out
  }
}

const SALE_COLS = 'id, sale_date, order_no, client, note, product_type, calculation_id, contract_id, lead_id, source'
const rows = await pageAll(() => sb.from('crm_sales').select(SALE_COLS)
  .eq('department', 'mglass').eq('voided', false).gte('sale_date', SINCE))
const todo = rows.filter(r => !String(r.product_type ?? '').trim())
console.log(`Розница с ${SINCE}: ${rows.length} продаж, без типа ${todo.length}`)

const ids = (xs, k) => [...new Set(xs.map(x => x[k]).filter(v => v != null))]
async function byIds(table, cols, key, list) {
  const out = []
  for (let i = 0; i < list.length; i += 300) {
    const { data, error } = await sb.from(table).select(cols).in(key, list.slice(i, i + 300))
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...data)
  }
  return out
}
const calcs = new Map((await byIds('calculations', 'id, product_type, input_data', 'id', ids(todo, 'calculation_id'))).map(c => [c.id, c]))
const contractsById = new Map((await byIds('contracts', 'id, number, product_kind', 'id', ids(todo, 'contract_id'))).map(c => [c.id, c]))
const allContracts = await pageAll(() => sb.from('contracts').select('id, number, product_kind'))
const contractsByNo = new Map()
for (const c of allContracts) {
  const k = R.normOrderNo(c.number)
  if (!k) continue
  if (!contractsByNo.has(k)) contractsByNo.set(k, [])
  contractsByNo.get(k).push(c)
}
const leads = new Map((await byIds('crm_leads', 'id, product', 'id', ids(todo, 'lead_id'))).map(l => [l.id, l]))

// Договор: свой договор строки, иначе все договоры с тем же номером заказа.
function dealKinds(r) {
  const own = r.contract_id ? contractsById.get(r.contract_id) : null
  return (own ? [own] : (contractsByNo.get(R.normOrderNo(r.order_no)) ?? [])).map(c => c.product_kind)
}

const amoCache = new Map()
async function amoFor(orderNo) {
  if (!orderNo) return null
  if (!amoCache.has(orderNo)) amoCache.set(orderNo, (await R.amoProductTypes([orderNo], amoGet)).get(orderNo))
  return amoCache.get(orderNo)
}

const results = []
let n = 0
for (const r of todo) {
  const calculation = r.calculation_id ? calcs.get(r.calculation_id) : null
  const kinds = dealKinds(r)
  const needAmo = !R.typesFromCalculation(calculation).length && !kinds.flatMap(R.typesFromKind).length
  const amo = needAmo ? await amoFor(r.order_no) : null
  const text = [r.note, r.lead_id ? leads.get(r.lead_id)?.product : null].filter(Boolean).join(' ')
  const pick = R.pickRetailProductType({ calculation, dealKinds: kinds, amo, text })
  results.push({ r, pick, amo })
  if (++n % 50 === 0) process.stdout.write(`  …${n}/${todo.length}\n`)
}

const bySource = new Map(), byValue = new Map()
for (const x of results) {
  const s = x.pick.source ?? 'не определено'
  bySource.set(s, (bySource.get(s) ?? 0) + 1)
  if (x.pick.value) byValue.set(x.pick.value, (byValue.get(x.pick.value) ?? 0) + 1)
}
const label = v => v.split(',').map(c => R.RETAIL_PRODUCT_LABELS[c]).join(' + ')
console.log('\nПо источнику:')
for (const s of ['calculation', 'deal', 'amo_field', 'amo_name', 'text', 'не определено']) console.log(`  ${s.padEnd(14)} ${bySource.get(s) ?? 0}`)
console.log('\nРаспределение по типам:')
for (const [v, c] of [...byValue].sort((a, b) => b[1] - a[1])) console.log(`  ${String(c).padStart(4)}  ${v}  (${label(v)})`)
// Одиночные коды — сколько продаж содержит изделие, включая составные.
const per = new Map()
for (const x of results) for (const c of R.parseProductTypes(x.pick.value)) per.set(c, (per.get(c) ?? 0) + 1)
console.log('\nПродаж, где есть изделие (составные считаются в каждом):')
for (const c of R.RETAIL_PRODUCT_TYPES) if (per.get(c)) console.log(`  ${R.RETAIL_PRODUCT_LABELS[c].padEnd(26)} ${per.get(c)}`)

// Четыре и больше изделий в одной продаже — скорее «отметили всё» в amo, чем состав.
const many = results.filter(x => R.parseProductTypes(x.pick.value).length >= 4)
if (many.length) {
  console.log(`\nЧетыре и больше изделий в продаже — проверить в amo (${many.length}):`)
  for (const x of many) console.log(`  ${x.r.order_no} → ${x.pick.value}  (сделки ${x.amo?.leadIds?.join(',') ?? '—'})`)
}

const undet = results.filter(x => !x.pick.value)
const noLead = undet.filter(x => !x.amo?.leadIds?.length).length
const ambiguous = undet.filter(x => x.amo?.ambiguous).length
console.log(`\nНе определено: ${undet.length} из ${results.length} — сделка amo не найдена ${noLead}, найдена без типа ${undet.length - noLead - ambiguous}, название неоднозначно ${ambiguous}`)
for (const x of undet.slice(0, 15)) console.log(`  ${x.r.order_no ?? '—'}  ${x.r.sale_date}  сделок amo: ${x.amo?.leadIds?.length ?? 0}`)

console.log('\nПримеры по правилам-по-тексту (до 10 на правило):')
for (const s of ['amo_name', 'text']) {
  const ex = results.filter(x => x.pick.source === s).slice(0, 10)
  console.log(`  ${s}: ${bySource.get(s) ?? 0}`)
  for (const x of ex) console.log(`    ${x.r.order_no} → ${x.pick.value}  (сделки ${x.amo?.leadIds?.join(',') ?? '—'})`)
}
console.log('\nПримеры amo_field (10):')
for (const x of results.filter(x => x.pick.source === 'amo_field').slice(0, 10)) console.log(`    ${x.r.order_no} → ${x.pick.value}`)

// Сверка источника: до июня 2025 книга сама вела графу «изделие» — сравниваем её
// (тем же правилом по тексту) с тем, что даёт amo по тем же заказам.
if (has('check-old')) {
  const old = await pageAll(() => sb.from('crm_sales').select('id, order_no, product_type')
    .eq('department', 'mglass').eq('voided', false).lt('sale_date', SINCE).not('product_type', 'is', null))
  let same = 0, sub = 0, diff = 0, bookOnly = 0, amoOnly = 0, none = 0
  const diffs = []
  for (const o of old) {
    const book = R.classifyProductText(o.product_type).types
    const a = (await amoFor(o.order_no))?.types ?? []
    if (!book.length && !a.length) none++
    else if (!a.length) bookOnly++
    else if (!book.length) amoOnly++
    else if (book.join() === a.join()) same++
    else if (a.every(t => book.includes(t)) || book.every(t => a.includes(t))) sub++
    else { diff++; if (diffs.length < 10) diffs.push(`${o.order_no}: книга «${o.product_type}» → ${book.join(',')}, amo → ${a.join(',')}`) }
  }
  console.log(`\nСверка amo с графой книги до ${SINCE}: ${old.length} строк`)
  console.log(`  совпало ${same}, одно — часть другого ${sub}, разошлось ${diff}, только книга ${bookOnly}, только amo ${amoOnly}, ни там ни там ${none}`)
  for (const d of diffs) console.log('   ', d)
}

if (!APPLY) {
  console.log(`\nСухой прогон: записано 0. К записи ${results.filter(x => x.pick.value).length} строк. Запись — с флагом --apply.`)
  process.exit(0)
}

let written = 0, skipped = 0
for (const x of results) {
  if (!x.pick.value) continue
  // Пишем только в пустое: строку, которую кто-то заполнил после чтения, не трогаем.
  const { data, error } = await sb.from('crm_sales').update({ product_type: x.pick.value })
    .eq('id', x.r.id).or('product_type.is.null,product_type.eq.').select('id')
  if (error) throw new Error(`crm_sales #${x.r.id}: ${error.message}`)
  if (data?.length) written++
  else skipped++
}
console.log(`\nЗаписано ${written}, пропущено (уже заполнено или RLS) ${skipped}`)
