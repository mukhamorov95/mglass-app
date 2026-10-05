// Разбор книги владельца «Продажи Мгласс» — чистые функции, без сети и базы.
//
// Почему htmlview, а не CSV: в книге «оплачено» отмечено ЦВЕТОМ ячейки
// (зелёная предоплата = деньги пришли), а CSV-выгрузка цвет теряет. htmlview
// отдаёт и значения, и класс стиля каждой ячейки, и номер строки листа —
// номер нужен как ключ импорта: одна строка книги = одна продажа.

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']

// «Июль 26» → 2026-07. Год в книге двузначный; век подставляем 20xx.
export function parseTabMonth(name) {
  const m = /^\s*([А-Яа-яЁё]+)\s*(\d{2}|\d{4})\s*$/.exec(name ?? '')
  if (!m) return null
  const mi = MONTHS.indexOf(m[1].toLowerCase())
  if (mi < 0) return null
  const y = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2])
  return `${y}-${String(mi + 1).padStart(2, '0')}`
}

// «р.186 500» → 186500. Пустое и «-» → null (это не ноль: ноль владелец пишет «р.0»).
export function parseMoney(raw) {
  const s = String(raw ?? '').replace(/р\.|₽| |\s/g, '').replace(',', '.')
  if (!s || s === '-') return null
  const v = Number(s)
  return Number.isFinite(v) ? v : null
}

// «02.07.2026» → 2026-07-02. Даты 1900 года — артефакт пустой ячейки с формулой.
// Календарь проверяем: в книге живьём встретилось «31.09.2026» — такого дня нет,
// и база такую дату не примет.
export function parseDate(raw) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(raw ?? '').trim())
  if (!m) return null
  const [, d, mo, y] = m.map(Number)
  if (y < 2000) return null
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return `${m[3]}-${m[2]}-${m[1]}`
}

// Сумма, набранная текстом («По 95 900»). Формула книги такую ячейку не считает,
// и «Продаж за месяц» в книге занижается, хотя продажа настоящая: предоплата и
// остаток стоят. Число берём, только если оно в ячейке одно, а строку отдаём в
// отчёт сверки: чинить надо ячейку в книге (поймано на 0907-4 в августе 2026).
export function parseMoneyLoose(raw) {
  const strict = parseMoney(raw)
  if (strict != null) return { value: strict, text: false }
  const groups = (String(raw ?? '').match(/\d[\d\s\u00a0]*(?:[.,]\d+)?/g) ?? []).map(g => g.trim()).filter(Boolean)
  if (groups.length !== 1) return { value: null, text: false }
  const v = parseMoney(groups[0])
  return v == null ? { value: null, text: false } : { value: v, text: true }
}

// Зелёная заливка = оплачено. Белая = нет. Красная = нет (и обычно пометка о проблеме).
// Решаем по каналам, а не по списку: оттенков зелёного в книге несколько.
export function paidFromColor(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex ?? ''))
  if (!m) return false
  const [r, g, b] = [1, 2, 3].map(i => parseInt(m[i], 16))
  if (r > 240 && g > 240 && b > 240) return false
  return g > r + 12 && g > b + 12
}

const stripTags = s => String(s).replace(/<[^>]+>/g, '')
const unescapeHtml = s => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
const cellText = s => unescapeHtml(stripTags(s)).replace(/\s+/g, ' ').trim()

// Строки листа из htmlview: номер строки (как в книге) + значения и цвета ячеек.
export function parseSheetRows(html, gid) {
  const css = {}
  for (const m of html.matchAll(/\.(s\d+)\{([^}]*)\}/g)) css[m[1]] = m[2]
  const bg = cls => {
    const m = /background-color:(#[0-9a-f]{6})/i.exec(css[cls] ?? '')
    return m ? m[1].toLowerCase() : null
  }
  const rows = []
  const rowRe = new RegExp(`<th id="${gid}R(\\d+)"[^>]*>.*?</th>(.*?)</tr>`, 'gs')
  for (const m of html.matchAll(rowRe)) {
    // Класс ячейки бывает не один: у склеенных по ширине стоит «s32 softmerge».
    // Если требовать ровно один класс, такая ячейка выпадает и вся строка
    // съезжает влево — клиент попадает в сумму (поймано на 0912-4 в августе).
    const cells = [...m[2].matchAll(/<td class="([^"]*)"[^>]*>(.*?)<\/td>/gs)]
      .map(c => ({ text: cellText(c[2]), color: bg((/\bs\d+\b/.exec(c[1]) ?? [''])[0]) }))
    // В книге строки нумеруются с 1, а в разметке индекс с нуля.
    rows.push({ row: Number(m[1]) + 1, cells })
  }
  return rows
}

const HEADERS = {
  'дата': 'date',
  'дата готовности': 'ready',
  'отдел': 'department',
  'номер заказа': 'orderNo',
  'клиент': 'client',
  'сумма заказа': 'amount',
  'партнёрские': 'partnerFee',
  'партнерские': 'partnerFee',
  'предоплата': 'prepayment',
  'остаток': 'remainder',
  'способ оплаты': 'method',
  'менеджер': 'manager',
  'статус': 'status',
}

// Колонки ищем по подписям, а не по номерам: в разных месяцах книга сдвигалась.
export function findColumns(rows) {
  for (const r of rows) {
    const map = {}
    r.cells.forEach((c, i) => {
      const key = HEADERS[c.text.toLowerCase().trim()]
      if (key && map[key] === undefined) map[key] = i
    })
    if (map.amount !== undefined && map.orderNo !== undefined && map.manager !== undefined) {
      return { headerRow: r.row, cols: map }
    }
  }
  return null
}

const PAY = ['Счёт', 'Наличные', 'Карта', 'Перевод']

// Строка книги → продажа. null, если строка пустая (в книге сотни пустых заготовок).
export function rowToSale(row, cols, tab, ledgerMonth) {
  const at = key => (cols[key] === undefined ? null : row.cells[cols[key]] ?? null)
  const val = key => at(key)?.text ?? ''
  const amountCell = parseMoneyLoose(val('amount'))
  const amount = amountCell.value
  const prepayment = parseMoney(val('prepayment'))
  const orderNo = val('orderNo').trim()
  const client = val('client').trim()
  const saleDate = parseDate(val('date'))
  if (!orderNo && !client && amount == null && prepayment == null) return null

  // Продажа — только строка с «Суммой заказа». Строки, где сумма пуста, а
  // предоплата стоит, — это доплаты по ранее проданному заказу: книга не
  // считает их в «Продаж за месяц», и первый импорт их тоже не брал. Молча
  // не выбрасываем: возвращаем со skip, чтобы скрипт их показал.
  if (amount == null || amount <= 0) {
    return prepayment ? { skip: 'без суммы заказа', order_no: orderNo || null, client: client || null, prepayment, row: row.row } : null
  }

  const method = val('method').trim()
  return {
    skip: null,
    row: row.row,
    // Не колонка базы — пометка для отчёта: сумма в книге набрана текстом.
    amount_text: amountCell.text ? val('amount').trim() : null,
    external_key: `gsheet:${tab}:${row.row}`,
    ledger_month: ledgerMonth,
    sale_date: saleDate ?? `${ledgerMonth}-01`,
    ready_date: parseDate(val('ready')),
    department: 'mglass',
    order_no: orderNo || null,
    client: client || null,
    amount,
    partner_fee: parseMoney(val('partnerFee')) ?? 0,
    prepayment: prepayment ?? 0,
    prepayment_paid: paidFromColor(at('prepayment')?.color),
    remainder_paid: paidFromColor(at('remainder')?.color),
    payment_method: PAY.includes(method) ? method : 'Счёт',
    manager: val('manager').trim() || null,
    status: val('status').trim().toLowerCase().startsWith('закрыт') ? 'closed' : 'open',
    // Дата продажи в книге не проставлена — месяц берём по вкладке, но строку
    // помечаем: в ведомости она должна быть видна как требующая проверки.
    needs_review: !saleDate,
  }
}

export function parseTab(html, gid, tab) {
  const ledgerMonth = parseTabMonth(tab)
  if (!ledgerMonth) throw new Error(`Вкладка «${tab}»: не месяц`)
  const rows = parseSheetRows(html, gid)
  const found = findColumns(rows)
  if (!found) throw new Error(`Вкладка «${tab}»: не найдена строка заголовков`)
  const sales = [], skipped = []
  for (const r of rows) {
    if (r.row <= found.headerRow) continue
    const sale = rowToSale(r, found.cols, tab, ledgerMonth)
    if (!sale) continue
    if (sale.skip) skipped.push(sale)
    else sales.push(sale)
  }
  return { ledgerMonth, headerRow: found.headerRow, sales, skipped }
}

// Вкладки книги: имя → gid, в том порядке, в каком они идут внизу таблицы.
export function parseTabList(html) {
  const out = []
  for (const m of html.matchAll(/items\.push\(\{name:\s*"((?:[^"\\]|\\.)*)"[\s\S]{0,400}?gid:\s*"(\d+)"/g)) {
    const name = m[1].replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\\//g, '/')
    if (!out.some(t => t.gid === m[2])) out.push({ name, gid: m[2] })
  }
  return out
}

// Итоги «Продаж за месяц» с листа МГЛАСС (CSV): строка начинается с года, дальше
// двенадцать месячных сумм. Это число книги, с которым сверяется реестр.
export function parseBookTotals(csv) {
  const out = new Map()
  for (const line of String(csv ?? '').split('\n')) {
    const cells = line.split('","').map(c => c.replace(/^"|"$/g, ''))
    if (!/^\d{4}$/.test(cells[0])) continue
    cells.slice(1, 13).forEach((v, i) => {
      const n = Number(String(v).replace(/р\.| |\s/g, ''))
      if (Number.isFinite(n) && n > 0) out.set(`${cells[0]}-${String(i + 1).padStart(2, '0')}`, n)
    })
  }
  return out
}

// CSV из gviz: поля в кавычках, внутри кавычек бывают переводы строк и "".
export function parseCsv(text) {
  const rows = []
  let row = [], cell = '', q = false
  const s = String(text ?? '')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (q) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') q = false
      else cell += ch
    } else if (ch === '"') q = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (ch !== '\r') cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}

// Статусы со скрытой вкладки (CSV gviz по имени листа). null — это не вкладка
// месяца: незнакомое имя gviz молча подменяет первым листом книги.
export function parseStatusTab(csv) {
  const rows = parseCsv(csv)
  const norm = t => String(t ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
  const h = rows.findIndex(r => r.some(c => norm(c) === 'номер заказа') && r.some(c => norm(c) === 'статус'))
  if (h < 0) return null
  const noCol = rows[h].findIndex(c => norm(c) === 'номер заказа')
  const stCol = rows[h].findIndex(c => norm(c) === 'статус')
  return rows.slice(h + 1)
    .map(r => ({ order_no: (r[noCol] ?? '').trim(), status: norm(r[stCol]) }))
    .filter(r => r.order_no && /\d/.test(r.order_no) && r.status)
    .map(r => ({ order_no: r.order_no, closed: r.status.startsWith('закрыт') }))
}
