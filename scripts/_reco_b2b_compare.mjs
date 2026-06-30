// Reconciliation analysis: app b2b_orders vs Google Sheets (Май/Июнь 26 + actual launch slices)
// Read-only. Produces a structured report to /tmp/reco/report.json + console.
import fs from 'node:fs'
import path from 'node:path'

// ─── Load app data ───────────────────────────────────────────────────────────
const mayApp  = JSON.parse(fs.readFileSync('/tmp/reco/app_may_created.json', 'utf8'))
const juneApp = JSON.parse(fs.readFileSync('/tmp/reco/app_june_created.json', 'utf8'))

function parseNotes(n) {
  if (!n) return {}
  if (typeof n === 'object') return n
  try { return JSON.parse(n) } catch { return {} }
}

function normalizeAppRow(r) {
  const meta = parseNotes(r.notes)
  const status = meta.status || null
  const amt = Number(r.total_after_discount ?? r.total_sale_inc_vat ?? 0)
  return {
    id: r.id,
    custom_number: (r.custom_number || '').trim() || null,
    client_order_number: (r.client_order_number || '').trim() || null,
    client_name: (r.client_name || '').trim(),
    total: Math.round(amt),
    created_at: r.created_at?.slice(0, 10) || '',
    launched_at: meta.launched_at?.slice(0, 10) || null,
    status,
    archived: !!r.archived_at,
  }
}

function isOrder(a) {
  return !a.archived && a.status && a.status !== 'quote'
}

const mayOrders  = mayApp.map(normalizeAppRow).filter(isOrder)
const juneOrders = juneApp.map(normalizeAppRow).filter(isOrder)
const mayQuotes  = mayApp.map(normalizeAppRow).filter(r => !r.archived && r.status === 'quote')
const juneQuotes = juneApp.map(normalizeAppRow).filter(r => !r.archived && r.status === 'quote')
const mayArch    = mayApp.map(normalizeAppRow).filter(r => r.archived && r.status !== 'quote')
const juneArch   = juneApp.map(normalizeAppRow).filter(r => r.archived && r.status !== 'quote')

// ─── Load Google sheets ──────────────────────────────────────────────────────
function parseCSV(text) {
  const rows = []
  let cur = [''], inQuote = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuote) {
      if (c === '"' && text[i + 1] === '"') { cur[cur.length - 1] += '"'; i++ }
      else if (c === '"') { inQuote = false }
      else { cur[cur.length - 1] += c }
    } else {
      if (c === '"') { inQuote = true }
      else if (c === ',') { cur.push('') }
      else if (c === '\n') { rows.push(cur); cur = [''] }
      else if (c === '\r') { /* skip */ }
      else { cur[cur.length - 1] += c }
    }
  }
  if (cur.length > 1 || cur[0]) rows.push(cur)
  return rows
}

function parseMoney(s) {
  if (!s) return null
  const t = String(s).replace(/р\.?/g, '').replace(/\s|\xa0/g, '').replace(',', '.').trim()
  if (!t) return null
  const n = parseFloat(t)
  return Number.isFinite(n) ? Math.round(n) : null
}

function parseRuDate(s) {
  if (!s) return null
  const m = String(s).trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  if (!m) return null
  const [, d, mo, y] = m
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
}

function loadSheet(filepath, label) {
  const csv = fs.readFileSync(filepath, 'utf8')
  const rows = parseCSV(csv)
  // skip first 3 header rows (banner / column titles / sum row)
  const data = []
  for (const r of rows.slice(3)) {
    if (r.length < 7) continue
    const num    = (r[1] || '').trim()
    const mgr    = (r[2] || '').trim()
    const client = (r[3] || '').trim()
    const launch = parseRuDate(r[4])
    const finish = parseRuDate(r[5])
    const amt    = parseMoney(r[6])
    const ship   = parseRuDate(r[18])
    // skip totally empty
    if (!num && !client && !launch && !amt) continue
    data.push({ num, mgr, client, launch, finish, amt, ship, sheet: label })
  }
  return data
}

const sheetMay  = loadSheet('/tmp/sheet_may.csv',  'Май 26')
const sheetJune = loadSheet('/tmp/sheet_june.csv', 'Июнь 26')
const sheetJuly = loadSheet('/tmp/sheet_gid_1044947619.csv', 'Июль 26')

function inMonth(iso, month, year = '2026') {
  if (!iso) return false
  return iso.startsWith(`${year}-${month}-`)
}

const sheetMay_launchMay   = sheetMay.filter(r => inMonth(r.launch, '05'))   // 13
const sheetMay_launchApr   = sheetMay.filter(r => inMonth(r.launch, '04'))   // 126
const sheetJune_launchMay  = sheetJune.filter(r => inMonth(r.launch, '05'))  // 137 — фактический май
const sheetJune_launchJune = sheetJune.filter(r => inMonth(r.launch, '06'))  // 31
const sheetJuly_launchJune = sheetJuly.filter(r => inMonth(r.launch, '06'))  // 140 — фактический июнь

// ─── Matching ────────────────────────────────────────────────────────────────
function normNum(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, '').replace(/^кп/,'').replace(/^кп№/,'').replace(/№/,'')
}
function normClient(s) {
  return String(s || '').toLowerCase().replace(/[^a-zа-я0-9]+/gi, '')
}

function matchAppToSheet(appRows, sheetRows) {
  // Build sheet index by num
  const bySheetNum = new Map()
  for (const s of sheetRows) {
    if (s.num) {
      const k = normNum(s.num)
      if (k) {
        if (!bySheetNum.has(k)) bySheetNum.set(k, [])
        bySheetNum.get(k).push(s)
      }
    }
  }
  const matched = []
  const usedSheet = new Set()
  const usedApp = new Set()
  const ambiguous = []

  // ── PASS 1: custom_number → sheet.num (global)
  for (const a of appRows) {
    if (!a.custom_number) continue
    const cands = (bySheetNum.get(normNum(a.custom_number)) || []).filter(c => !usedSheet.has(c))
    if (cands.length === 0) continue
    cands.sort((x, y) => Math.abs((x.amt ?? 0) - a.total) - Math.abs((y.amt ?? 0) - a.total))
    const s = cands[0]
    matched.push({ app: a, sheet: s, confidence: 'high', via: 'custom_number' })
    usedSheet.add(s); usedApp.add(a)
  }

  // ── PASS 2: client_order_number → sheet.num (global)
  for (const a of appRows) {
    if (usedApp.has(a)) continue
    if (!a.client_order_number) continue
    const cands = (bySheetNum.get(normNum(a.client_order_number)) || []).filter(c => !usedSheet.has(c))
    if (cands.length === 0) continue
    const s = cands[0]
    matched.push({ app: a, sheet: s, confidence: 'medium', via: 'client_order_number' })
    usedSheet.add(s); usedApp.add(a)
  }

  // ── PASS 3: soft — client + amount + close date
  for (const a of appRows) {
    if (usedApp.has(a)) continue
    const ac = normClient(a.client_name)
    const candidates = sheetRows.filter(s => !usedSheet.has(s) && normClient(s.client) === ac)
    const exactAmt = candidates.filter(c => c.amt === a.total)
    let pool = exactAmt
    let conf = 'medium'
    if (pool.length === 0) {
      pool = candidates.filter(c => c.amt && Math.abs(c.amt - a.total) / Math.max(c.amt, a.total) <= 0.02)
      conf = 'low'
    }
    if (pool.length > 0) {
      const appDate = a.launched_at || a.created_at
      pool.sort((x, y) => {
        const dx = x.launch ? Math.abs(new Date(x.launch) - new Date(appDate)) : Infinity
        const dy = y.launch ? Math.abs(new Date(y.launch) - new Date(appDate)) : Infinity
        return dx - dy
      })
      if (pool.length > 1) ambiguous.push({ app: a, candidates: pool })
      const s = pool[0]
      matched.push({ app: a, sheet: s, confidence: conf, via: exactAmt.length ? 'client+amount' : 'client+~amount' })
      usedSheet.add(s); usedApp.add(a)
    }
  }

  const missingInSheet = appRows.filter(a => !usedApp.has(a))
  const extrasInSheet = sheetRows.filter(s => !usedSheet.has(s))
  return { matched, missingInSheet, extrasInSheet, ambiguous }
}

// ─── Run 2 scenarios per month ───────────────────────────────────────────────
const scenarios = {
  may_byTab: {
    label: 'A. Май: app(май, не-quote, не-арх) vs весь лист «Май 26»',
    app: mayOrders, sheet: sheetMay,
  },
  june_byTab: {
    label: 'A. Июнь: app(июнь, не-quote, не-арх) vs весь лист «Июнь 26»',
    app: juneOrders, sheet: sheetJune,
  },
  may_byLaunch: {
    label: 'B. Май: app(май, не-quote, не-арх) vs строки launch=05.2026 в листе «Июнь 26»',
    app: mayOrders, sheet: sheetJune_launchMay,
  },
  june_byLaunch: {
    label: 'B. Июнь: app(июнь, не-quote, не-арх) vs строки launch=06.2026 в листе «Июль 26»',
    app: juneOrders, sheet: sheetJuly_launchJune,
  },
}

const results = {}
for (const [key, s] of Object.entries(scenarios)) {
  results[key] = { ...s, ...matchAppToSheet(s.app, s.sheet) }
}

// ─── Quote candidates for promotion ──────────────────────────────────────────
function quoteCandidates(quotes, sheetRows, monthLabel) {
  // For quotes that have indicators they became orders
  const promotable = []
  const review    = []
  const skip      = []
  for (const q of quotes) {
    const reasons = []
    if (q.custom_number) reasons.push(`custom_number=${q.custom_number}`)
    if (q.client_order_number) reasons.push(`client_order_number=${q.client_order_number}`)
    // try to find sheet row by custom_number / client_order_number
    let sheetHit = null
    if (q.custom_number) {
      sheetHit = sheetRows.find(s => s.num && normNum(s.num) === normNum(q.custom_number))
    }
    if (!sheetHit && q.client_order_number) {
      sheetHit = sheetRows.find(s => s.num && normNum(s.num) === normNum(q.client_order_number))
    }
    if (sheetHit) reasons.push(`есть в листе как №${sheetHit.num}`)

    if (sheetHit || (q.custom_number && q.client_order_number)) {
      promotable.push({ q, sheetHit, reasons })
    } else if (q.custom_number || q.client_order_number) {
      review.push({ q, reasons })
    } else {
      skip.push(q)
    }
  }
  return { promotable, review, skip }
}

// Combined sheet rows to search (Май+Июнь+Июль)
const allSheetRows = [...sheetMay, ...sheetJune, ...sheetJuly]
const mayQuoteCands  = quoteCandidates(mayQuotes,  allSheetRows, 'май')
const juneQuoteCands = quoteCandidates(juneQuotes, allSheetRows, 'июнь')

// ─── Duplicates inside the app (by custom_number) ────────────────────────────
function findDupes(rows) {
  const byNum = new Map()
  for (const r of rows) {
    if (r.custom_number) {
      const k = normNum(r.custom_number)
      if (!byNum.has(k)) byNum.set(k, [])
      byNum.get(k).push(r)
    }
  }
  const dupes = []
  for (const [k, list] of byNum) if (list.length > 1) dupes.push({ key: k, rows: list })
  return dupes
}
const appDupesMay  = findDupes([...mayOrders, ...mayQuotes])
const appDupesJune = findDupes([...juneOrders, ...juneQuotes])

// ─── Output ──────────────────────────────────────────────────────────────────
function fmt(n) { return new Intl.NumberFormat('ru-RU').format(n) }

function printSummaryTable() {
  console.log('\n# A. Сверка по названию вкладки\n')
  console.log('| Месяц | App orders | App ₽ | Sheet rows | Sheet ₽ | Matched | Miss in sheet | Extra in sheet |')
  console.log('|---|---|---|---|---|---|---|---|')
  for (const k of ['may_byTab', 'june_byTab']) {
    const r = results[k]
    const appSum = r.app.reduce((s, a) => s + a.total, 0)
    const sheetSum = r.sheet.reduce((s, x) => s + (x.amt || 0), 0)
    const month = k.startsWith('may') ? 'Май' : 'Июнь'
    console.log(`| ${month} | ${r.app.length} | ${fmt(appSum)} | ${r.sheet.length} | ${fmt(sheetSum)} | ${r.matched.length} | ${r.missingInSheet.length} | ${r.extrasInSheet.length} |`)
  }
  console.log('\n# B. Сверка по фактическому launch-месяцу внутри листа\n')
  console.log('| Месяц | App orders | App ₽ | Sheet rows | Sheet ₽ | Matched | Miss in sheet | Extra in sheet |')
  console.log('|---|---|---|---|---|---|---|---|')
  for (const k of ['may_byLaunch', 'june_byLaunch']) {
    const r = results[k]
    const appSum = r.app.reduce((s, a) => s + a.total, 0)
    const sheetSum = r.sheet.reduce((s, x) => s + (x.amt || 0), 0)
    const month = k.startsWith('may') ? 'Май' : 'Июнь'
    console.log(`| ${month} | ${r.app.length} | ${fmt(appSum)} | ${r.sheet.length} | ${fmt(sheetSum)} | ${r.matched.length} | ${r.missingInSheet.length} | ${r.extrasInSheet.length} |`)
  }
}

function printMissing(scenarioKey, sheetLabel) {
  const r = results[scenarioKey]
  console.log(`\n## Кандидаты на добавление в Google-таблицу — сценарий ${scenarioKey} (предлагаемый лист: «${sheetLabel}»)\n`)
  // Group by confidence (no soft-match attempted; all unmatched are "high" missing
  // (they didn't match anything). But we add confidence by data completeness.)
  const high   = []
  const medium = []
  const low    = []
  for (const a of r.missingInSheet) {
    if (a.custom_number) high.push(a)
    else if (a.client_order_number) medium.push(a)
    else low.push(a)
  }
  function fmtRow(a, conf, reason) {
    return `| ${sheetLabel} | ${a.custom_number || '—'} | ${a.client_order_number || '—'} | ${a.client_name} | ${fmt(a.total)} | ${a.created_at} | ${a.status} | ${conf} | ${reason} |`
  }
  console.log('| Лист | custom_number | client_order_number | Клиент | Сумма | created_at | Статус | Confidence | Причина |')
  console.log('|---|---|---|---|---|---|---|---|---|')
  for (const a of high)   console.log(fmtRow(a, 'high',   'есть custom_number — однозначно идентифицируется'))
  for (const a of medium) console.log(fmtRow(a, 'medium', 'есть client_order_number, но не custom_number'))
  for (const a of low)    console.log(fmtRow(a, 'low',    'только клиент+сумма — требуется ручная проверка'))
}

function printExtras(scenarioKey) {
  const r = results[scenarioKey]
  console.log(`\n## Есть в листе, но нет в app — сценарий ${scenarioKey} (${r.extrasInSheet.length} строк)\n`)
  console.log('| sheet.num | sheet.client | sheet.amt | sheet.launch | sheet.ship |')
  console.log('|---|---|---|---|---|')
  for (const s of r.extrasInSheet) {
    console.log(`| ${s.num || '—'} | ${s.client || '—'} | ${s.amt != null ? fmt(s.amt) : '—'} | ${s.launch || '—'} | ${s.ship || '—'} |`)
  }
}

function printQuoteCands(qc, monthLabel) {
  console.log(`\n## Просчёты-кандидаты на перенос в B2B-заказы (${monthLabel})\n`)
  console.log(`### 1. Можно рассмотреть перенос (${qc.promotable.length})`)
  console.log('| app.id | custom_number | client_order_number | Клиент | Сумма | created_at | Причины |')
  console.log('|---|---|---|---|---|---|---|')
  for (const x of qc.promotable) {
    const q = x.q
    console.log(`| ${q.id} | ${q.custom_number || '—'} | ${q.client_order_number || '—'} | ${q.client_name} | ${fmt(q.total)} | ${q.created_at} | ${x.reasons.join('; ')} |`)
  }
  console.log(`\n### 2. Требует ручной проверки (${qc.review.length})`)
  console.log('| app.id | custom_number | client_order_number | Клиент | Сумма | created_at | Причины |')
  console.log('|---|---|---|---|---|---|---|')
  for (const x of qc.review) {
    const q = x.q
    console.log(`| ${q.id} | ${q.custom_number || '—'} | ${q.client_order_number || '—'} | ${q.client_name} | ${fmt(q.total)} | ${q.created_at} | ${x.reasons.join('; ')} |`)
  }
  console.log(`\n### 3. Не переносить (${qc.skip.length} — без идентификаторов)`)
}

function printArch(arch, monthLabel) {
  console.log(`\n## Архивные не-quote записи (${monthLabel}) — отдельный список для подтверждения (${arch.length})\n`)
  if (arch.length === 0) { console.log('— нет'); return }
  console.log('| app.id | custom_number | client_order_number | Клиент | Сумма | created_at | Статус |')
  console.log('|---|---|---|---|---|---|---|')
  for (const a of arch) {
    console.log(`| ${a.id} | ${a.custom_number || '—'} | ${a.client_order_number || '—'} | ${a.client_name} | ${fmt(a.total)} | ${a.created_at} | ${a.status} |`)
  }
}

function printDupes(d, label) {
  console.log(`\n## Дубли по custom_number внутри app (${label})\n`)
  if (d.length === 0) { console.log('— нет'); return }
  console.log('| custom_number | ids | clients | amounts | statuses |')
  console.log('|---|---|---|---|---|')
  for (const g of d) {
    const ids   = g.rows.map(r => r.id).join(', ')
    const cls   = [...new Set(g.rows.map(r => r.client_name))].join(' / ')
    const amts  = [...new Set(g.rows.map(r => fmt(r.total)))].join(' / ')
    const sts   = [...new Set(g.rows.map(r => r.status + (r.archived ? '(arch)' : '')))].join(' / ')
    console.log(`| ${g.key} | ${ids} | ${cls} | ${amts} | ${sts} |`)
  }
}

// Dump
printSummaryTable()
for (const k of Object.keys(results)) printMissing(k, k.startsWith('may') ? (k.endsWith('byTab') ? 'Май 26' : 'Июнь 26') : (k.endsWith('byTab') ? 'Июнь 26' : 'Июль 26'))
for (const k of Object.keys(results)) printExtras(k)
printQuoteCands(mayQuoteCands,  'май')
printQuoteCands(juneQuoteCands, 'июнь')
printArch(mayArch,  'май')
printArch(juneArch, 'июнь')
printDupes(appDupesMay,  'май')
printDupes(appDupesJune, 'июнь')

// Persist
fs.writeFileSync('/tmp/reco/report.json', JSON.stringify({
  scenarios: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, {
    label: v.label,
    appCount: v.app.length, appSum: v.app.reduce((s,a)=>s+a.total,0),
    sheetCount: v.sheet.length, sheetSum: v.sheet.reduce((s,x)=>s+(x.amt||0),0),
    matched: v.matched.length, missing: v.missingInSheet.length, extra: v.extrasInSheet.length,
    missingInSheet: v.missingInSheet,
    extrasInSheet: v.extrasInSheet,
    matchedRows: v.matched,
  }])),
  mayQuoteCands, juneQuoteCands,
  mayArch, juneArch,
  appDupesMay, appDupesJune,
}, null, 2))
console.log('\n[saved] /tmp/reco/report.json')
