// Б9: разбор банковской выписки. Два формата, которые реально выгружают банки:
//  • 1CClientBankExchange (txt) — общий для Альфы, Т-Банка, Сбера;
//  • CSV из личного кабинета банка (колонки ищем по заголовку, не по позиции).
// Модуль чистый: ни базы, ни сети, ни Date.now — дата и «наши счета» приходят
// параметрами. Направление определяется по нашему расчётному счёту, а не по
// знаку суммы: в 1С-обмене суммы всегда положительные.

export type BankRow = {
  docNo: string | null
  date: string                 // YYYY-MM-DD
  amount: number
  direction: 'in' | 'out'
  counterparty: string | null
  inn: string | null
  purpose: string | null
  account: string | null       // наш счёт по этой строке
  externalKey: string          // идемпотентность повторной загрузки
}

// Остатки по счёту из СекцияРасчСчет — банк отдаёт их сам. Начальный остаток
// закрывает ввод для Б15 без ручного набора; итоги дают сверку «сошлось / нет».
export type AccountBalance = {
  account: string
  opening: number | null
  credit: number | null      // ВсегоПоступило
  debit: number | null       // ВсегоСписано
  closing: number | null
  dateStart: string | null
  dateEnd: string | null
}

export type ParseResult =
  | { ok: true; format: '1c' | 'csv'; rows: BankRow[]; accounts: string[]; balances: AccountBalance[] }
  | { ok: false; error: string }

const pad = (n: number) => String(n).padStart(2, '0')

export function toIsoDate(raw: string): string | null {
  const s = raw.trim()
  let m = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(s)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{2})$/.exec(s)
  if (m) return `20${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`
  return null
}

export function toAmount(raw: string): number {
  const s = raw.replace(/\s| |₽|руб\.?/gi, '').replace(',', '.').replace(/[^\d.\-]/g, '')
  const v = Number(s)
  return Number.isFinite(v) ? v : NaN
}

// Ключ строки: банк не даёт стабильного id, поэтому склеиваем то, что не
// меняется между выгрузками. Номер документа входит — без него два одинаковых
// платежа одного дня схлопнулись бы в одну строку.
export function rowKey(r: Omit<BankRow, 'externalKey'>): string {
  return [
    r.date, r.direction, r.amount.toFixed(2),
    (r.docNo ?? '').trim(), (r.inn ?? '').trim(),
    (r.counterparty ?? '').trim().slice(0, 40).toLowerCase(),
  ].join('|')
}

const withKey = (r: Omit<BankRow, 'externalKey'>): BankRow => ({ ...r, externalKey: rowKey(r) })

// --- 1CClientBankExchange ---------------------------------------------

function parse1C(text: string): ParseResult {
  const lines = text.split(/\r?\n/)
  const accounts = new Set<string>()
  const rows: BankRow[] = []
  const balances: AccountBalance[] = []
  let doc: Record<string, string> | null = null
  let acct: Record<string, string> | null = null   // блок СекцияРасчСчет

  const numOrNull = (s: string | undefined) => {
    const v = toAmount(s ?? '')
    return Number.isFinite(v) ? v : null
  }

  for (const line of lines) {
    const eq = line.indexOf('=')
    const key = (eq > -1 ? line.slice(0, eq) : line).trim()
    const value = eq > -1 ? line.slice(eq + 1).trim() : ''

    if (key === 'СекцияДокумент') { doc = {}; continue }
    if (key === 'КонецДокумента') {
      if (doc) {
        const row = docTo1CRow(doc, accounts)
        if (row) rows.push(row)
      }
      doc = null
      continue
    }
    if (doc) { if (key) doc[key] = value; continue }

    // Блок остатков по счёту — банк отдаёт начальный/конечный остаток и обороты
    if (key === 'СекцияРасчСчет') { acct = {}; continue }
    if (key === 'КонецРасчСчет') {
      if (acct?.['РасчСчет']) {
        accounts.add(acct['РасчСчет'])
        balances.push({
          account: acct['РасчСчет'],
          opening: numOrNull(acct['НачальныйОстаток']),
          credit: numOrNull(acct['ВсегоПоступило']),
          debit: numOrNull(acct['ВсегоСписано']),
          closing: numOrNull(acct['КонечныйОстаток']),
          dateStart: toIsoDate(acct['ДатаНачала'] ?? ''),
          dateEnd: toIsoDate(acct['ДатаКонца'] ?? ''),
        })
      }
      acct = null
      continue
    }
    if (acct) { if (key) acct[key] = value; continue }

    // Вне блоков: расчётный счёт владельца файла (шапка)
    if (key === 'РасчСчет' && value) accounts.add(value)
  }

  // Пустой день — это валидная выписка, а не ошибка: банк прислал остатки без
  // движений. Ошибка только если файл вообще не похож на 1С-обмен (нет и остатков).
  if (!rows.length && !balances.length) {
    return { ok: false, error: 'В файле не нашлось ни одного документа формата 1С' }
  }
  return { ok: true, format: '1c', rows, accounts: [...accounts], balances }
}

function docTo1CRow(d: Record<string, string>, accounts: Set<string>): BankRow | null {
  const amount = toAmount(d['Сумма'] ?? '')
  if (!Number.isFinite(amount) || amount <= 0) return null

  const payerAcc = d['ПлательщикРасчСчет'] ?? d['ПлательщикСчет'] ?? ''
  const payeeAcc = d['ПолучательРасчСчет'] ?? d['ПолучательСчет'] ?? ''
  const paidIn = d['ДатаПоступило'] ?? ''
  const paidOut = d['ДатаСписано'] ?? ''

  // Приход — если наш счёт в получателях (или банк прямо проставил ДатаПоступило)
  const ours = (acc: string) => !!acc && accounts.has(acc)
  const direction: 'in' | 'out' =
    ours(payeeAcc) ? 'in'
    : ours(payerAcc) ? 'out'
    : paidIn ? 'in' : 'out'

  const date = toIsoDate(direction === 'in' ? (paidIn || d['Дата'] || '') : (paidOut || d['Дата'] || ''))
  if (!date) return null

  const cpName = direction === 'in'
    ? (d['Плательщик1'] || d['Плательщик'] || '')
    : (d['Получатель1'] || d['Получатель'] || '')
  const inn = direction === 'in' ? (d['ПлательщикИНН'] ?? '') : (d['ПолучательИНН'] ?? '')

  return withKey({
    docNo: d['Номер'] || null,
    date, amount, direction,
    counterparty: cleanName(cpName),
    inn: inn || null,
    purpose: d['НазначениеПлатежа'] || null,
    account: direction === 'in' ? (payeeAcc || null) : (payerAcc || null),
  })
}

// «ИНН 7701234567 ООО "Вандер"» → «ООО "Вандер"»
function cleanName(raw: string): string | null {
  const s = raw.replace(/^ИНН\s*\d{10,12}\s*/i, '').replace(/^КПП\s*\d{9}\s*/i, '').trim()
  return s || null
}

// --- CSV ---------------------------------------------------------------

const COL = {
  date: ['дата операции', 'дата проводки', 'дата платежа', 'дата', 'date'],
  amount: ['сумма операции', 'сумма в валюте счета', 'сумма', 'amount'],
  credit: ['приход', 'поступление', 'кредит', 'credit'],
  debit: ['расход', 'списание', 'дебет', 'debit'],
  cp: ['контрагент', 'наименование контрагента', 'плательщик', 'получатель', 'описание операции'],
  inn: ['инн', 'инн контрагента'],
  purpose: ['назначение платежа', 'назначение', 'комментарий', 'описание'],
  docNo: ['номер документа', 'номер', '№ документа'],
}

function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = []
  let cell = '', quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') { if (line[i + 1] === '"') { cell += '"'; i++ } else quoted = false }
      else cell += ch
    } else if (ch === '"' && cell === '') quoted = true   // кавычка только в начале ячейки: «ООО "Ветро"» без обрамления тоже читается
    else if (ch === sep) { out.push(cell); cell = '' }
    else cell += ch
  }
  out.push(cell)
  return out.map(c => c.trim())
}

function findCol(head: string[], names: string[]): number {
  const norm = head.map(h => h.toLowerCase().replace(/\s+/g, ' ').trim())
  for (const n of names) {
    const i = norm.findIndex(h => h === n)
    if (i > -1) return i
  }
  for (const n of names) {
    const i = norm.findIndex(h => h.includes(n))
    if (i > -1) return i
  }
  return -1
}

function parseCsv(text: string): ParseResult {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (!lines.length) return { ok: false, error: 'Файл пустой' }
  const sep = (lines[0].match(/;/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0) ? ';' : ','

  const headIdx = lines.findIndex(l => {
    const c = splitCsvLine(l, sep).map(x => x.toLowerCase())
    return c.some(x => x.includes('дата')) && c.some(x => x.includes('сумма') || x.includes('приход') || x.includes('расход'))
  })
  if (headIdx < 0) return { ok: false, error: 'Не нашлись колонки «дата» и «сумма» — это точно выписка?' }

  const head = splitCsvLine(lines[headIdx], sep)
  const iDate = findCol(head, COL.date)
  const iAmount = findCol(head, COL.amount)
  const iCredit = findCol(head, COL.credit)
  const iDebit = findCol(head, COL.debit)
  const iCp = findCol(head, COL.cp)
  const iInn = findCol(head, COL.inn)
  const iPurpose = findCol(head, COL.purpose)
  const iDoc = findCol(head, COL.docNo)

  const rows: BankRow[] = []
  for (const line of lines.slice(headIdx + 1)) {
    const c = splitCsvLine(line, sep)
    const date = toIsoDate(c[iDate] ?? '')
    if (!date) continue

    let amount = NaN
    let direction: 'in' | 'out' = 'out'
    if (iCredit > -1 || iDebit > -1) {
      const cr = iCredit > -1 ? toAmount(c[iCredit] ?? '') : NaN
      const db = iDebit > -1 ? toAmount(c[iDebit] ?? '') : NaN
      if (Number.isFinite(cr) && cr > 0) { amount = cr; direction = 'in' }
      else if (Number.isFinite(db) && db > 0) { amount = db; direction = 'out' }
    }
    if (!Number.isFinite(amount) && iAmount > -1) {
      const v = toAmount(c[iAmount] ?? '')
      if (Number.isFinite(v) && v !== 0) { amount = Math.abs(v); direction = v > 0 ? 'in' : 'out' }
    }
    if (!Number.isFinite(amount) || amount <= 0) continue

    rows.push(withKey({
      docNo: iDoc > -1 ? (c[iDoc] || null) : null,
      date, amount, direction,
      counterparty: iCp > -1 ? cleanName(c[iCp] ?? '') : null,
      inn: iInn > -1 ? (c[iInn] || null) : null,
      purpose: iPurpose > -1 ? (c[iPurpose] || null) : null,
      account: null,
    }))
  }

  if (!rows.length) return { ok: false, error: 'Строк с датой и суммой не нашлось' }
  // CSV из личного кабинета остатки в структурированном виде не несёт
  return { ok: true, format: 'csv', rows, accounts: [], balances: [] }
}

export function parseStatement(text: string): ParseResult {
  const head = text.slice(0, 400)
  if (/1CClientBankExchange|СекцияДокумент/i.test(head) || /СекцияДокумент/i.test(text.slice(0, 5000))) {
    return parse1C(text)
  }
  return parseCsv(text)
}

// Дубли внутри одной выгрузки схлопываем сразу: банк иногда отдаёт один
// документ дважды (проводка + комиссия одной строкой).
export function dedupe(rows: BankRow[]): BankRow[] {
  const seen = new Set<string>()
  return rows.filter(r => (seen.has(r.externalKey) ? false : (seen.add(r.externalKey), true)))
}
