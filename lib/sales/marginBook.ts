// Книга владельца «Маржа» → маржа объектов M-Glass.
//
// В книге на каждый месяц вкладка с теми же объектами, что в «Продажах Мгласс»,
// и переменные расходы по статьям. Маржинальный доход = сумма − все переменные.
// Здесь разбор вкладки, сверка с продажами и подсчёт маржи — одним способом для
// крона (app/api/cron/margin-book-sync), ручного запуска (scripts/import-margin-book.mjs)
// и страницы /sales/margin. Только относительные импорты: скрипт грузит файл самим Node.

import type { SupabaseClient } from '@supabase/supabase-js'
import { parseMoney, parseMoneyLoose, parseSheetRows, parseTabList, parseTabMonth } from './salesSheetParse.mjs'

export const MARGIN_BOOK_ID = '1E5jUrBxJUTXa74LAd7ZiNq6qMJq5e0J_yMWxqvRTdPY'
export const MARGIN_SINCE = '2026-01'

export const COST_KEYS = [
  'glass', 'hardware', 'designer', 'measurer', 'installer', 'delivery',
  'partners', 'claims', 'tax', 'bonus_manager', 'bonus_ror', 'bonus_rop',
] as const
export type CostKey = typeof COST_KEYS[number]

// «По объекту проставлены все расходы» — эти шесть статей заполнены, хотя бы нулём.
// Партнёров и рекламаций у большинства объектов нет: там пустая ячейка и значит
// «не было». Налог и бонусы книга считает формулой от суммы.
export const REQUIRED_COSTS: CostKey[] = ['glass', 'hardware', 'designer', 'measurer', 'installer', 'delivery']

export const COST_RU: Record<CostKey, string> = {
  glass: 'стекло', hardware: 'фурнитура', designer: 'конструктор', measurer: 'замерщик',
  installer: 'монтажник', delivery: 'доставка', partners: 'партнёры', claims: 'рекламации',
  tax: 'налог', bonus_manager: 'бонус менеджера', bonus_ror: 'бонус РОР', bonus_rop: 'бонус РОП',
}

type Col = CostKey | 'orderNo' | 'amount' | 'varTotal' | 'md' | 'dima'
const HEADER: Record<string, Col> = {
  '№ заказа': 'orderNo', 'а': 'orderNo', 'сумма заказа': 'amount',
  'стекло': 'glass', 'фурнитура': 'hardware', 'конструктор': 'designer', 'замерщик': 'measurer',
  'монтажник': 'installer', 'доставка': 'delivery', 'партнеры': 'partners', 'партнёры': 'partners',
  'рекламации': 'claims', 'налог': 'tax', 'итого переменных расходов по сделке': 'varTotal',
  'маржинальный доход': 'md', 'дима': 'dima',
}
const headerKey = (raw: string): Col | undefined => {
  const t = raw.toLowerCase().replace(/\s+/g, ' ').trim()
  if (HEADER[t]) return HEADER[t]
  if (t.startsWith('бонус менеджера')) return 'bonus_manager'
  if (t.startsWith('бонус рор')) return 'bonus_ror'
  if (t.startsWith('бонус роп')) return 'bonus_rop'
  return undefined
}

export type MarginBookRow = {
  row: number
  order_no: string
  amount: number
  costs: Record<CostKey, number | null>   // null — ячейка пустая, расход не проставлен
  text_cells: CostKey[]                    // набраны текстом: формула книги их не считает
  book_var_total: number | null
  book_md: number | null
  dima: number | null
}
export type MarginTab = { month: string; tab: string; rows: MarginBookRow[]; bookAmountTotal: number | null }

type SheetRow = { row: number; cells: { text: string; color: string | null }[] }

// htmlview показывает рубли без копеек: двенадцать округлённых статей расходятся
// с итогом книги до шести рублей, и это не ошибка.
const ROUNDING = COST_KEYS.length / 2
const cellsSum = (c: Record<CostKey, number | null>) => COST_KEYS.reduce((s, k) => s + (c[k] ?? 0), 0)

export function parseMarginTab(html: string, gid: string | number, tab: string): MarginTab {
  const month = parseTabMonth(tab)
  if (!month) throw new Error(`Вкладка «${tab}»: не месяц`)
  const rows = parseSheetRows(html, gid) as SheetRow[]
  const hdr = rows.find(r => r.cells.some(c => headerKey(c.text) === 'amount'))
  if (!hdr) return { month, tab, rows: [], bookAmountTotal: null }
  const col: Partial<Record<Col, number>> = {}
  hdr.cells.forEach((c, i) => { const k = headerKey(c.text); if (k && col[k] === undefined) col[k] = i })
  if (col.orderNo === undefined) col.orderNo = 0
  const text = (r: SheetRow, k: Col) => (col[k] === undefined ? '' : r.cells[col[k]!]?.text ?? '').trim()

  let bookAmountTotal: number | null = null
  const out: MarginBookRow[] = []
  for (const r of rows.filter(x => x.row > hdr.row)) {
    const no = text(r, 'orderNo')
    const amount = parseMoneyLoose(text(r, 'amount')).value as number | null
    // Первая строка под шапкой без номера — итоги месяца по формулам книги.
    if (!no) { if (bookAmountTotal == null && amount != null) bookAmountTotal = amount; continue }
    if (!/\d/.test(no) || amount == null) continue
    const costs = {} as Record<CostKey, number | null>
    const unformatted: CostKey[] = []
    for (const k of COST_KEYS) {
      const raw = text(r, k)
      costs[k] = raw ? (parseMoneyLoose(raw).value as number | null) : null
      if (raw && !raw.includes('р.')) unformatted.push(k)
    }
    const bookVar = parseMoney(text(r, 'varTotal')) as number | null
    // Число без «р.» стало текстом, только если формула книги его не посчитала:
    // число в другом формате формула считает, и тогда итоги сходятся.
    const skipped = bookVar != null && Math.abs(bookVar - cellsSum(costs)) > ROUNDING
    out.push({
      row: r.row, order_no: no, amount, costs,
      text_cells: skipped ? unformatted : [],
      book_var_total: bookVar,
      book_md: parseMoney(text(r, 'md')) as number | null,
      dima: parseMoney(text(r, 'dima')) as number | null,
    })
  }
  return { month, tab, rows: out, bookAmountTotal }
}

export type MarginSale = {
  id: number
  order_no: string | null
  client: string | null
  manager: string | null
  amount: number
  partner_fee: number | null
  status: string | null
}

export type Issue =
  | { kind: 'no_sale'; hint: string | null }
  | { kind: 'no_margin' }
  | { kind: 'amount'; margin: number; sale: number }
  | { kind: 'text_cells'; keys: CostKey[]; book: number; cells: number }
  | { kind: 'book_total'; book: number; cells: number }
  | { kind: 'missing_costs'; keys: CostKey[] }
  | { kind: 'partners'; margin: number; sale: number }

export type MarginObject = {
  month: string
  order_no: string | null
  sale_id: number | null
  row: number | null
  client: string | null
  manager: string | null
  closed: boolean
  amount: number                              // выручка: сумма из продаж, без продажи — из «Маржи»
  costs: Record<CostKey, number | null> | null
  var_total: number | null                    // все переменные; null — объекта нет в «Марже»
  md: number | null
  md_pct: number | null
  dima: number | null
  finance_cost: number | null                 // себестоимость для crm_sale_finance (витрина v_crm_sales_margin)
  issues: Issue[]
  precise: boolean
}

const r2 = (n: number) => Math.round(n * 100) / 100
const key = (s: string | null) => String(s ?? '').replace(/\s+/g, '').toLowerCase()

// Расхождение, из-за которого маржу объекта нельзя считать точной. Набранное
// текстом сюда не входит: статьи мы складываем сами, ошибается только итог книги.
export function blocksPrecision(o: Pick<MarginObject, 'closed'>, i: Issue): boolean {
  if (i.kind === 'amount') return true
  if (i.kind === 'missing_costs') return o.closed
  if (i.kind === 'partners') return i.sale > i.margin
  return i.kind === 'no_sale' || i.kind === 'no_margin'
}

// Что владельцу поправить в книгах. Открытый объект ещё не обязан быть в «Марже»
// и не обязан иметь все расходы; партнёрские, которые есть в «Марже», но не
// проставлены в «Продажах», маржу не искажают.
export function needsFix(o: Pick<MarginObject, 'closed'>, i: Issue): boolean {
  if (i.kind === 'no_margin' || i.kind === 'missing_costs') return o.closed
  if (i.kind === 'partners') return i.sale > i.margin
  return true
}

export function reconcileMonth(month: string, rows: MarginBookRow[], sales: MarginSale[]): MarginObject[] {
  const pool = new Map<string, MarginSale[]>()
  for (const s of sales) if (s.order_no) pool.set(key(s.order_no), [...(pool.get(key(s.order_no)) ?? []), s])
  const used = new Set<number>()
  const pairs = rows.map(r => {
    const list = (pool.get(key(r.order_no)) ?? []).filter(s => !used.has(s.id))
    // У доплат номер повторяется — берём строку с той же суммой, если есть.
    const s = list.find(x => Math.round(x.amount) === Math.round(r.amount)) ?? list[0] ?? null
    if (s) used.add(s.id)
    return { r, s }
  })
  const lone = sales.filter(s => !used.has(s.id))

  const objects: MarginObject[] = pairs.map(({ r, s }) => {
    const closed = s?.status === 'closed'
    const issues: Issue[] = []
    if (!s) {
      const twin = lone.find(x => Math.round(x.amount) === Math.round(r.amount))
      issues.push({ kind: 'no_sale', hint: twin?.order_no ?? null })
    }
    if (s && Math.round(s.amount) !== Math.round(r.amount)) issues.push({ kind: 'amount', margin: r.amount, sale: Number(s.amount) })
    const cells = cellsSum(r.costs)
    if (r.text_cells.length) issues.push({ kind: 'text_cells', keys: r.text_cells, book: r.book_var_total!, cells: r2(cells) })
    else if (r.book_var_total != null && Math.abs(r.book_var_total - cells) > ROUNDING) issues.push({ kind: 'book_total', book: r.book_var_total, cells: r2(cells) })
    const missing = REQUIRED_COSTS.filter(k => r.costs[k] == null)
    if (missing.length) issues.push({ kind: 'missing_costs', keys: missing })

    // Партнёрские в продажах больше, чем в «Марже», — считаем бо́льшие: деньги
    // партнёру уходят из той же суммы, занизить расход хуже, чем завысить.
    const mp = r.costs.partners ?? 0
    const pf = Number(s?.partner_fee ?? 0)
    if (s && Math.round(pf) !== Math.round(mp)) issues.push({ kind: 'partners', margin: mp, sale: pf })
    const costs = pf > mp ? { ...r.costs, partners: pf } : r.costs

    const amount = s ? Number(s.amount) : r.amount
    const varTotal = r2(cellsSum(costs))
    const md = r2(amount - varTotal)
    const o: MarginObject = {
      month, order_no: r.order_no, sale_id: s?.id ?? null, row: r.row,
      client: s?.client ?? null, manager: s?.manager ?? null, closed,
      amount, costs, var_total: varTotal, md,
      md_pct: amount ? md / amount * 100 : null,
      dima: r.dima,
      // Витрина считает «сумма − партнёрские − себестоимость», поэтому партнёрские
      // продажи из себестоимости вычитаем: иначе они уйдут из маржи дважды.
      finance_cost: s ? r2(amount - pf - md) : null,
      issues, precise: false,
    }
    o.precise = closed && !issues.some(i => blocksPrecision(o, i))
    return o
  })
  for (const s of lone) {
    objects.push({
      month, order_no: s.order_no, sale_id: s.id, row: null, client: s.client, manager: s.manager,
      closed: s.status === 'closed', amount: Number(s.amount), costs: null, var_total: null,
      md: null, md_pct: null, dima: null, finance_cost: null, issues: [{ kind: 'no_margin' }], precise: false,
    })
  }
  return objects
}

export type MarginSummary = {
  objects: number
  closed: number
  precise: number
  revenue: number          // закрытые и точно посчитанные
  md: number
  md_pct: number | null
  dima: number
  pending: { count: number; revenue: number }            // закрыты, но посчитать точно нельзя
  open: { count: number; revenue: number; md: number }   // ещё не закрыты, предварительно по «Марже»
  notInMargin: number                                     // открытые продажи, которых в «Марже» пока нет
}

export function summarize(objects: MarginObject[]): MarginSummary {
  const p = objects.filter(o => o.precise)
  const revenue = p.reduce((s, o) => s + o.amount, 0)
  const md = p.reduce((s, o) => s + (o.md ?? 0), 0)
  const pending = objects.filter(o => o.closed && !o.precise)
  const open = objects.filter(o => !o.closed && o.sale_id != null && o.var_total != null)
  return {
    objects: objects.length,
    closed: objects.filter(o => o.closed).length,
    precise: p.length,
    revenue, md, md_pct: revenue ? md / revenue * 100 : null,
    dima: p.reduce((s, o) => s + (o.dima ?? 0), 0),
    pending: { count: pending.length, revenue: pending.reduce((s, o) => s + o.amount, 0) },
    open: { count: open.length, revenue: open.reduce((s, o) => s + o.amount, 0), md: open.reduce((s, o) => s + (o.md ?? 0), 0) },
    notInMargin: objects.filter(o => !o.closed && o.var_total == null).length,
  }
}

// Деньги периода так, как их читает владелец: продажи → прямые расходы по заказам →
// маржа (остаток). База — продажи из «Продаж M-Glass»; строка «Маржи» без продажи
// в суммы не входит (она в правках). «Неполные» — объекты, у которых расходы внесены
// не все или не внесены вовсе: их маржа завышена, это видно рядом с цифрой.
export type Scope = 'all' | 'closed'
export type PeriodTotals = {
  objects: number
  closed: number
  sales: number
  costs: number
  margin: number
  margin_pct: number | null
  byCost: Record<CostKey, number>
  partial: number
  base: number
}

export function periodTotals(objects: MarginObject[], scope: Scope = 'all'): PeriodTotals {
  const sold = objects.filter(o => o.sale_id != null)
  const base = scope === 'closed' ? sold.filter(o => o.closed) : sold
  const byCost = Object.fromEntries(COST_KEYS.map(k => [k, 0])) as Record<CostKey, number>
  for (const o of base) if (o.costs) for (const k of COST_KEYS) byCost[k] += o.costs[k] ?? 0
  const sales = r2(base.reduce((s, o) => s + o.amount, 0))
  const costs = r2(base.reduce((s, o) => s + (o.var_total ?? 0), 0))
  return {
    objects: sold.length,
    closed: sold.filter(o => o.closed).length,
    sales, costs, margin: r2(sales - costs),
    margin_pct: sales ? (sales - costs) / sales * 100 : null,
    byCost,
    partial: base.filter(o => o.var_total == null || o.issues.some(i => i.kind === 'missing_costs')).length,
    base: base.length,
  }
}

// Строка базы → строка книги: страница пересчитывает маржу тем же reconcileMonth.
export type MarginDbRow = { row_no: number; order_no: string | null; amount: number | null; text_cells: string[] | null; book_var_total: number | null; book_md: number | null; dima: number | null } & Record<CostKey, number | null>
export function fromDb(r: MarginDbRow): MarginBookRow {
  const costs = {} as Record<CostKey, number | null>
  for (const k of COST_KEYS) costs[k] = r[k] == null ? null : Number(r[k])
  const num = (v: number | null) => (v == null ? null : Number(v))
  return {
    row: r.row_no, order_no: r.order_no ?? '', amount: Number(r.amount ?? 0), costs,
    text_cells: (r.text_cells ?? []) as CostKey[],
    book_var_total: num(r.book_var_total), book_md: num(r.book_md), dima: num(r.dima),
  }
}

export const SALE_COLUMNS = 'id, order_no, client, manager, amount, partner_fee, status, ledger_month'

// ─── Синхронизация ────────────────────────────────────────────────────────────

export type MarginMonthReport = {
  month: string
  tab: string
  rows: number
  held: string | null
  bookAmountTotal: number | null
  rowsAmount: number
  summary: MarginSummary
  objects: MarginObject[]
}
export type MarginSyncReport = { dry: boolean; months: MarginMonthReport[]; financeUpdated: number; error?: string }

type Fetch = (url: string) => Promise<string>
const defaultFetch: Fetch = async url => {
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) throw new Error(`HTTP ${r.status} — книга «Маржа» должна быть открыта по ссылке`)
  return r.text()
}

export async function syncMarginBook(
  sb: SupabaseClient,
  opts: { dry?: boolean; since?: string; fetchText?: Fetch } = {},
): Promise<MarginSyncReport> {
  const fetchText = opts.fetchText ?? defaultFetch
  const since = opts.since ?? MARGIN_SINCE
  const base = `https://docs.google.com/spreadsheets/d/${MARGIN_BOOK_ID}`
  const tabs = (parseTabList(await fetchText(`${base}/htmlview`)) as { name: string; gid: string }[])
    .filter(t => { const m = parseTabMonth(t.name); return m && m >= since })
  if (tabs.length === 0) return { dry: !!opts.dry, months: [], financeUpdated: 0, error: 'В книге «Маржа» не найдено месячных вкладок' }

  const parsed: MarginTab[] = []
  for (const t of tabs) parsed.push(parseMarginTab(await fetchText(`${base}/htmlview/sheet?headers=true&gid=${t.gid}`), t.gid, t.name.trim()))

  const { data: salesData, error: salesErr } = await sb.from('crm_sales').select(SALE_COLUMNS)
    .in('ledger_month', parsed.map(p => p.month)).eq('voided', false).neq('department', 'b2b').range(0, 9999)
  if (salesErr) throw new Error(`Продажи: ${salesErr.message}`)
  const sales = (salesData ?? []) as unknown as (MarginSale & { ledger_month: string })[]

  const months: MarginMonthReport[] = []
  const financeWanted = new Map<number, number>()
  const now = new Date().toISOString()
  for (const tab of parsed) {
    const objects = reconcileMonth(tab.month, tab.rows, sales.filter(s => s.ledger_month === tab.month))
    const { data: ex, error: exErr } = await sb.from('margin_book_rows').select('id, external_key, voided').eq('ledger_month', tab.month)
    if (exErr) throw new Error(`${tab.tab}: ${exErr.message}`)
    const live = (ex ?? []).filter(r => !r.voided)
    // Вкладка прочиталась пустой, а вчера строки были — скорее сломалось чтение, чем
    // владелец стёр месяц. Месяц не трогаем.
    const held = tab.rows.length === 0 && live.length > 0 ? 'вкладка прочиталась пустой — месяц не тронут' : null

    if (!opts.dry && !held) {
      const keyOf = (row: number) => `marja:${tab.month}:${row}`
      const bySale = new Map(objects.filter(o => o.row != null).map(o => [o.row!, o.sale_id]))
      const rows = tab.rows.map(r => ({
        external_key: keyOf(r.row), ledger_month: tab.month, tab: tab.tab, row_no: r.row, order_no: r.order_no,
        sale_id: bySale.get(r.row) ?? null, amount: r.amount, ...r.costs, text_cells: r.text_cells,
        book_var_total: r.book_var_total, book_md: r.book_md, dima: r.dima, voided: false, synced_at: now,
      }))
      if (rows.length) {
        const { error } = await sb.from('margin_book_rows').upsert(rows, { onConflict: 'external_key' })
        if (error) throw new Error(`${tab.tab}: ${error.message}`)
      }
      const keep = new Set(rows.map(r => r.external_key))
      const gone = live.filter(r => !keep.has(r.external_key)).map(r => r.id)
      if (gone.length) {
        const { error } = await sb.from('margin_book_rows').update({ voided: true, synced_at: now }).in('id', gone)
        if (error) throw new Error(`${tab.tab}: ${error.message}`)
      }
    }
    if (!held) for (const o of objects) if (o.sale_id != null && o.finance_cost != null) financeWanted.set(o.sale_id, o.finance_cost)

    months.push({
      month: tab.month, tab: tab.tab, rows: tab.rows.length, held,
      bookAmountTotal: tab.bookAmountTotal, rowsAmount: tab.rows.reduce((s, r) => s + r.amount, 0),
      summary: summarize(objects), objects,
    })
  }

  // Себестоимость для витрины CFO — из тех же строк. Поставленную руками
  // (cost_overridden) не трогаем; неизменившуюся не переписываем.
  let financeUpdated = 0
  const ids = [...financeWanted.keys()]
  if (ids.length) {
    const { data: fin, error: finErr } = await sb.from('crm_sale_finance').select('sale_id, cost, cost_source, cost_overridden').in('sale_id', ids)
    if (finErr) throw new Error(`Себестоимость: ${finErr.message}`)
    const cur = new Map((fin ?? []).map(f => [f.sale_id as number, f as { cost: number; cost_source: string; cost_overridden: boolean }]))
    const changed = ids.filter(id => {
      const f = cur.get(id)
      return !f?.cost_overridden && (!f || Math.abs(Number(f.cost) - financeWanted.get(id)!) >= 0.01 || f.cost_source !== 'import')
    })
    financeUpdated = changed.length
    if (!opts.dry && changed.length) {
      const { error } = await sb.from('crm_sale_finance').upsert(
        changed.map(id => ({ sale_id: id, cost: financeWanted.get(id)!, cost_source: 'import', updated_at: now })),
        { onConflict: 'sale_id' },
      )
      if (error) throw new Error(`Себестоимость: ${error.message}`)
    }
  }
  return { dry: !!opts.dry, months, financeUpdated }
}

// ─── Отчёт в Telegram ─────────────────────────────────────────────────────────

const MONTHS_RU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
export const monthRu = (ym: string) => MONTHS_RU[Number(ym.slice(5, 7)) - 1] ?? ym
const rub = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`
const pct = (n: number | null) => (n == null ? '—' : `${n.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`)
const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const list = (keys: CostKey[]) => keys.map(k => COST_RU[k]).join(', ')

// Одна строка на расхождение: где в какой книге и что поправить.
export function fixLine(m: { month: string; tab: string }, o: MarginObject, i: Issue): string {
  const at = `«Маржа» ${esc(m.tab)}${o.row ? `, стр. ${o.row}` : ''}, ${esc(o.order_no ?? '—')}`
  switch (i.kind) {
    case 'no_sale': return `${at}: такого заказа нет в «Продажах» ${monthRu(m.month).toLowerCase()}${i.hint ? ` — может, это ${esc(i.hint)}?` : ''}`
    case 'no_margin': return `${monthRu(m.month)}, ${esc(o.order_no ?? o.client ?? '—')}: закрыт в «Продажах», в «Марже» строки нет`
    case 'amount': return `${at}: сумма ${rub(i.margin)}, в «Продажах» ${rub(i.sale)}`
    case 'text_cells': return `${at}: текстом набрано — ${list(i.keys)}; формула книги это не считает, расходы в книге занижены на ${rub(i.cells - i.book)}`
    case 'book_total': return `${at}: «Итого переменных» ${rub(i.book)}, а статьи складываются в ${rub(i.cells)}`
    case 'missing_costs': return `${at}: закрыт, не проставлено — ${list(i.keys)}`
    case 'partners': return `${at}: партнёрские ${rub(i.margin)}, в «Продажах» ${rub(i.sale)}`
  }
}

export function formatMarginReport(r: MarginSyncReport, limit = 3900): string {
  const head = `📐 <b>Маржа</b> — книга «Маржа» ↔ «Продажи»${r.dry ? ' (сухой прогон)' : ''}`
  if (r.error) return `${head}\n⚠️ ${esc(r.error)}`
  const lines = [head]
  const fixes: string[] = []
  let partnersInfo = 0, notInMargin = 0
  for (const m of r.months) {
    const own = m.objects.flatMap(o => o.issues.filter(i => needsFix(o, i)).map(i => ({ o, i })))
    const icon = m.held ? '⚠️' : own.length ? '✏️' : '✅'
    const t = periodTotals(m.objects)
    lines.push(`${icon} ${monthRu(m.month)}: продажи ${rub(t.sales)} · расходы ${rub(t.costs)} · маржа ${pct(t.margin_pct)}${m.held ? ` — ${m.held}` : ''}`)
    if (t.partial) lines.push(`   расходы неполные у ${t.partial} из ${t.objects} — маржа завышена`)
    if (m.bookAmountTotal != null && Math.round(m.bookAmountTotal) !== Math.round(m.rowsAmount)) {
      fixes.push(`«Маржа» ${esc(m.tab)}: итог «Сумма заказа» ${rub(m.bookAmountTotal)}, строки складываются в ${rub(m.rowsAmount)}`)
    }
    // Незаполненные расходы закрытых — одной строкой на месяц, иначе список заслонит остальное.
    const missing = own.filter(x => x.i.kind === 'missing_costs')
    for (const x of own.filter(x => x.i.kind !== 'missing_costs')) fixes.push(fixLine(m, x.o, x.i))
    if (missing.length) {
      const nos = missing.slice(0, 6).map(x => esc(x.o.order_no)).join(', ')
      fixes.push(`«Маржа» ${esc(m.tab)}: у ${missing.length} закрытых не проставлены все расходы — ${nos}${missing.length > 6 ? ' и др.' : ''}`)
    }
    partnersInfo += m.objects.filter(o => o.issues.some(i => i.kind === 'partners' && !needsFix(o, i))).length
    notInMargin += m.summary.notInMargin
  }
  const closed = periodTotals(r.months.flatMap(m => m.objects), 'closed')
  lines.push(`\nЗакрытые объекты (${closed.base}): продажи ${rub(closed.sales)} · маржа <b>${rub(closed.margin)}</b> · ${pct(closed.margin_pct)}`)
  if (closed.partial) lines.push(`у ${closed.partial} из них расходы неполные`)
  if (r.financeUpdated) lines.push(`Себестоимость в CFO ${r.dry ? 'обновится' : 'обновлена'} у ${r.financeUpdated} продаж`)
  if (fixes.length) {
    lines.push('', '✏️ <b>Поправить в книгах</b>')
    const tail = (n: number) => `…и ещё ${n} — на странице «Маржа»`
    let used = lines.join('\n').length + 60
    let shown = 0
    for (const f of fixes) {
      if (used + f.length + 3 > limit) break
      lines.push(`• ${f}`); used += f.length + 3; shown++
    }
    if (shown < fixes.length) lines.push(tail(fixes.length - shown))
  }
  const info: string[] = []
  if (notInMargin) info.push(`ещё не внесены в «Маржу» — ${notInMargin} открытых`)
  if (partnersInfo) info.push(`в «Продажах» не проставлены партнёрские у ${partnersInfo} (в «Марже» есть)`)
  if (info.length && lines.join('\n').length + 80 < limit) lines.push('', `ℹ️ ${info.join('; ')}`)
  return lines.join('\n')
}
