// Final candidate list under scenario B (launch-month → tab N+1)
// High+Medium for auto-add, Low separately, plus quote/archive informational lists.
import fs from 'node:fs'

const report = JSON.parse(fs.readFileSync('/tmp/reco/report.json', 'utf8'))

function fmt(n) { return new Intl.NumberFormat('ru-RU').format(n) }

const may  = report.scenarios.may_byLaunch
const june = report.scenarios.june_byLaunch

function classify(a) {
  if (a.custom_number) return 'high'
  if (a.client_order_number) return 'medium'
  return 'low'
}

function split(rows) {
  const high = [], medium = [], low = []
  for (const a of rows) {
    const c = classify(a)
    if (c === 'high') high.push(a)
    else if (c === 'medium') medium.push(a)
    else low.push(a)
  }
  return { high, medium, low }
}

const mayS  = split(may.missingInSheet)
const juneS = split(june.missingInSheet)

console.log('# A. Финальный список к добавлению (High + Medium, сценарий B)\n')
console.log('## A1. Май 2026 → лист «Июнь 26»')
console.log(`Всего к добавлению: ${mayS.high.length + mayS.medium.length} (high ${mayS.high.length} + medium ${mayS.medium.length})\n`)
console.log('| Лист | custom_number | client_order_number | Клиент | Сумма | created_at | Статус | Confidence | Почему добавляем |')
console.log('|---|---|---|---|---|---|---|---|---|')
for (const a of [...mayS.high, ...mayS.medium]) {
  const conf = classify(a)
  const why = conf === 'high'
    ? `есть custom_number=${a.custom_number}; в листе «Июнь 26» с launch=05.2026 не найден`
    : `есть client_order_number=${a.client_order_number}; в листе «Июнь 26» с launch=05.2026 не найден`
  console.log(`| Июнь 26 | ${a.custom_number || '—'} | ${a.client_order_number || '—'} | ${a.client_name} | ${fmt(a.total)} | ${a.created_at} | ${a.status} | ${conf} | ${why} |`)
}
if (mayS.high.length + mayS.medium.length === 0) console.log('| — | — | — | — | — | — | — | — | нет high/medium кандидатов |')

console.log('\n## A2. Июнь 2026 → лист «Июль 26»')
console.log(`Всего к добавлению: ${juneS.high.length + juneS.medium.length} (high ${juneS.high.length} + medium ${juneS.medium.length})\n`)
console.log('| Лист | custom_number | client_order_number | Клиент | Сумма | created_at | Статус | Confidence | Почему добавляем |')
console.log('|---|---|---|---|---|---|---|---|---|')
for (const a of [...juneS.high, ...juneS.medium]) {
  const conf = classify(a)
  const why = conf === 'high'
    ? `есть custom_number=${a.custom_number}; в листе «Июль 26» с launch=06.2026 не найден`
    : `есть client_order_number=${a.client_order_number}; в листе «Июль 26» с launch=06.2026 не найден`
  console.log(`| Июль 26 | ${a.custom_number || '—'} | ${a.client_order_number || '—'} | ${a.client_name} | ${fmt(a.total)} | ${a.created_at} | ${a.status} | ${conf} | ${why} |`)
}

// ─── B. Low — manual ─────────────────────────────────────────────────────────
console.log('\n# B. Не добавлять без ручной проверки (Low confidence)\n')
console.log(`Май: ${mayS.low.length}; Июнь: ${juneS.low.length}\n`)
console.log('| Месяц | Лист | Номер | Клиент | Сумма | created_at | Confidence | Почему low |')
console.log('|---|---|---|---|---|---|---|---|')
for (const a of mayS.low) {
  console.log(`| Май | Июнь 26 | — | ${a.client_name} | ${fmt(a.total)} | ${a.created_at} | low | нет ни custom_number, ни client_order_number — возможен дубль или нерелевантная запись |`)
}
for (const a of juneS.low) {
  console.log(`| Июнь | Июль 26 | — | ${a.client_name} | ${fmt(a.total)} | ${a.created_at} | low | нет ни custom_number, ни client_order_number — возможен дубль или нерелевантная запись |`)
}

// ─── C. Quote candidates ─────────────────────────────────────────────────────
console.log('\n# C. Quote-кандидаты на перенос в B2B-заказы (справочно, Supabase не меняем)\n')

console.log('## C1. Май')
console.log(`Можно рассмотреть: ${report.mayQuoteCands.promotable.length}; ручная проверка: ${report.mayQuoteCands.review.length}\n`)
console.log('| Группа | app.id | custom_number | client_order_number | Клиент | Сумма | created_at | Почему кандидат |')
console.log('|---|---|---|---|---|---|---|---|')
for (const x of report.mayQuoteCands.promotable) {
  const q = x.q
  console.log(`| Можно рассмотреть | ${q.id} | ${q.custom_number || '—'} | ${q.client_order_number || '—'} | ${q.client_name} | ${fmt(q.total)} | ${q.created_at} | ${x.reasons.join('; ')} |`)
}
for (const x of report.mayQuoteCands.review) {
  const q = x.q
  console.log(`| Ручная проверка | ${q.id} | ${q.custom_number || '—'} | ${q.client_order_number || '—'} | ${q.client_name} | ${fmt(q.total)} | ${q.created_at} | ${x.reasons.join('; ')} |`)
}

console.log('\n## C2. Июнь')
console.log(`Можно рассмотреть: ${report.juneQuoteCands.promotable.length}; ручная проверка: ${report.juneQuoteCands.review.length}\n`)
console.log('| Группа | app.id | custom_number | client_order_number | Клиент | Сумма | created_at | Почему кандидат |')
console.log('|---|---|---|---|---|---|---|---|')
for (const x of report.juneQuoteCands.promotable) {
  const q = x.q
  console.log(`| Можно рассмотреть | ${q.id} | ${q.custom_number || '—'} | ${q.client_order_number || '—'} | ${q.client_name} | ${fmt(q.total)} | ${q.created_at} | ${x.reasons.join('; ')} |`)
}
for (const x of report.juneQuoteCands.review) {
  const q = x.q
  console.log(`| Ручная проверка | ${q.id} | ${q.custom_number || '—'} | ${q.client_order_number || '—'} | ${q.client_name} | ${fmt(q.total)} | ${q.created_at} | ${x.reasons.join('; ')} |`)
}

// ─── D. Archive ──────────────────────────────────────────────────────────────
console.log('\n# D. Архивные non-quote записи (справочно, не восстанавливаем)\n')
console.log(`Май: ${report.mayArch.length}; Июнь: ${report.juneArch.length}\n`)
if (report.juneArch.length > 0) {
  console.log('## Июнь')
  console.log('| app.id | custom_number | client_order_number | Клиент | Сумма | created_at | Статус | Почему архив |')
  console.log('|---|---|---|---|---|---|---|---|')
  for (const a of report.juneArch) {
    console.log(`| ${a.id} | ${a.custom_number || '—'} | ${a.client_order_number || '—'} | ${a.client_name} | ${fmt(a.total)} | ${a.created_at} | ${a.status} | помечен archived_at (вероятно — отменён или дубль) |`)
  }
}
if (report.mayArch.length > 0) {
  console.log('## Май')
  console.log('| app.id | custom_number | Клиент | Сумма | created_at | Статус |')
  console.log('|---|---|---|---|---|---|')
  for (const a of report.mayArch) {
    console.log(`| ${a.id} | ${a.custom_number || '—'} | ${a.client_name} | ${fmt(a.total)} | ${a.created_at} | ${a.status} |`)
  }
}

// ─── E. Amount mismatches in matched rows ────────────────────────────────────
console.log('\n# E. Расхождения по суммам в найденных совпадениях (high-confidence матчи)\n')
function listAmtMismatch(sc, label) {
  const rows = []
  for (const m of sc.matchedRows || []) {
    if (m.confidence === 'high') {
      const a = m.app, s = m.sheet
      if (s.amt && a.total !== s.amt) rows.push({ a, s, diff: a.total - s.amt })
    }
  }
  console.log(`## ${label}: ${rows.length}`)
  if (rows.length === 0) return
  console.log('| custom_number | Клиент | App ₽ | Sheet ₽ | Разница | App created_at | Sheet launch |')
  console.log('|---|---|---|---|---|---|---|')
  for (const r of rows) {
    console.log(`| ${r.a.custom_number} | ${r.a.client_name} | ${fmt(r.a.total)} | ${fmt(r.s.amt)} | ${r.diff > 0 ? '+' : ''}${fmt(r.diff)} | ${r.a.created_at} | ${r.s.launch || '—'} |`)
  }
}
listAmtMismatch(report.scenarios.may_byLaunch,  'Май (Июнь 26)')
listAmtMismatch(report.scenarios.june_byLaunch, 'Июнь (Июль 26)')

// Persist final list to file
fs.writeFileSync('/tmp/reco/final_to_add.json', JSON.stringify({
  may_to_june26: [...mayS.high, ...mayS.medium],
  june_to_july26: [...juneS.high, ...juneS.medium],
  low_may: mayS.low,
  low_june: juneS.low,
  quote_promotable_may: report.mayQuoteCands.promotable,
  quote_promotable_june: report.juneQuoteCands.promotable,
  quote_review_may: report.mayQuoteCands.review,
  quote_review_june: report.juneQuoteCands.review,
  archive_may: report.mayArch,
  archive_june: report.juneArch,
}, null, 2))

console.log('\n[saved] /tmp/reco/final_to_add.json')
