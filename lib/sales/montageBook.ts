// Книга «Монтажи 2023» — выплаты монтажникам по заказам. Несмотря на название, ведётся по
// сей день: вкладки «Январь 25» … «Сентябрь 26» (ранние скрыты). Строка — заказ: № заказа,
// сумма, колонки с именами монтажников (состав меняется от месяца к месяцу) и «Дима РОР» —
// 5 % от маржинального дохода руководителю отдела реализации (владелец, 06.10). Правее —
// отдельный реестр выплат по датам, к заказам не относится. По этой книге владелец
// заполнял «Монтажника» в «Марже»; приложение её только читает и сверяет с «Маржой».
// Только сервер: здесь адрес книги.

import { parseCsv, parseTabList, parseTabMonth } from './salesSheetParse.mjs'

export const MONTAGE_BOOK_ID = '1OJuKZVGoIWybdBt4ThoA8mAR-aFUTdDS6LpS8g19dk8'
export const MONTAGE_SINCE = '2025-01'

export type MontageRow = { order_no: string; installers: Record<string, number>; dima: number | null; unreadable: number }
export type MontageEntry = { installers: number; byName: Record<string, number>; dima: number | null; tabs: string[] }
export type MontageBook = { orders: Map<string, MontageEntry>; tabs: string[]; missing: string[]; unreadable: number }

const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim()
const num = (s: unknown) => {
  const t = String(s ?? '').replace(/[\s  ]/g, '').replace(',', '.')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : NaN
}
export const orderKey = (s: string | null | undefined) => String(s ?? '').replace(/\s+/g, '').toLowerCase()

// Монтажники — колонки между «Суммой» и «Дима РОР» с непустой шапкой. «Дима Монтаж»
// (декабрь 24) — монтажник, «Дима РОР» — нет.
export function parseMontageCsv(csv: string): MontageRow[] | null {
  const rows = parseCsv(csv) as string[][]
  const h = rows.findIndex(r => r.some(c => clean(c).toLowerCase() === '№ заказа'))
  if (h < 0) return null
  const head = rows[h].map(clean)
  const low = head.map(c => c.toLowerCase())
  const noCol = low.indexOf('№ заказа')
  const sumCol = low.indexOf('сумма')
  const dimaCol = low.findIndex(c => c.startsWith('дима') && c.includes('рор'))
  const payCol = low.findIndex(c => c.startsWith('выплаты'))
  const end = dimaCol > -1 ? dimaCol : payCol > -1 ? payCol : head.length
  const cols: number[] = []
  for (let i = Math.max(sumCol, noCol) + 1; i < end; i++) if (head[i]) cols.push(i)

  const out: MontageRow[] = []
  for (const r of rows.slice(h + 1)) {
    const order_no = clean(r[noCol])
    if (!order_no || !/\d/.test(order_no) || /^р\./i.test(order_no)) continue
    const installers: Record<string, number> = {}
    let unreadable = 0
    for (const i of cols) {
      const v = num(r[i])
      if (v == null || v === 0) continue
      if (Number.isNaN(v)) { unreadable++; continue }
      installers[head[i]] = (installers[head[i]] ?? 0) + v
    }
    const d = dimaCol > -1 ? num(r[dimaCol]) : null
    if (Number.isNaN(d)) unreadable++
    out.push({ order_no, installers, dima: d == null || Number.isNaN(d) ? null : d, unreadable })
  }
  return out
}

export function collectMontage(tabs: { tab: string; rows: MontageRow[] }[]): Map<string, MontageEntry> {
  const orders = new Map<string, MontageEntry>()
  for (const { tab, rows } of tabs) for (const r of rows) {
    const k = orderKey(r.order_no)
    const e = orders.get(k) ?? { installers: 0, byName: {}, dima: null, tabs: [] }
    for (const [name, v] of Object.entries(r.installers)) { e.byName[name] = (e.byName[name] ?? 0) + v; e.installers += v }
    if (r.dima != null) e.dima = (e.dima ?? 0) + r.dima
    if (!e.tabs.includes(tab)) e.tabs.push(tab)
    orders.set(k, e)
  }
  return orders
}

type Fetch = (url: string) => Promise<string>
const defaultFetch: Fetch = async url => {
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) throw new Error(`HTTP ${r.status} — книга «Монтажи» должна быть открыта по ссылке`)
  return r.text()
}
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const nextMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}` }

export async function loadMontageBook(fetchText: Fetch = defaultFetch, since = MONTAGE_SINCE): Promise<MontageBook> {
  const base = `https://docs.google.com/spreadsheets/d/${MONTAGE_BOOK_ID}`
  const csvUrl = (q: string) => `${base}/gviz/tq?tqx=out:csv&${q}`
  const visible = (parseTabList(await fetchText(`${base}/htmlview`)) as { name: string; gid: string }[])
    .map(t => ({ name: t.name.trim(), gid: t.gid, month: parseTabMonth(t.name) as string | null }))
    .filter((t): t is { name: string; gid: string; month: string } => !!t.month && t.month >= since)
  const last = visible.map(t => t.month).sort().at(-1)
  if (!last) throw new Error('В книге «Монтажи» не найдено месячных вкладок')
  const seen = new Set(visible.map(t => t.month))
  const hidden: string[] = []
  for (let m = since; m <= last; m = nextMonth(m)) if (!seen.has(m)) hidden.push(m)

  // Скрытые вкладки gviz отдаёт по имени, а незнакомое имя молча подменяет первым листом
  // книги (январь 2023, шапка похожа): ответ, совпавший с заведомо несуществующим
  // именем, — «вкладки нет».
  const fallback = await fetchText(csvUrl(`sheet=${encodeURIComponent('__нет такого листа__')}`))
  const byName = async (m: string) => {
    const [y, mo] = m.split('-')
    for (const n of [`${MONTHS[Number(mo) - 1]} ${y.slice(2)}`, `${MONTHS[Number(mo) - 1]} ${y}`]) {
      const csv = await fetchText(csvUrl(`sheet=${encodeURIComponent(n)}`))
      if (csv !== fallback) return { tab: n, csv }
    }
    return { tab: m, csv: null }
  }
  const got = await Promise.all([
    ...visible.map(async t => ({ tab: t.name, csv: await fetchText(csvUrl(`gid=${t.gid}`)) as string | null })),
    ...hidden.map(byName),
  ])
  const parsed: { tab: string; rows: MontageRow[] }[] = []
  const missing: string[] = []
  for (const g of got) {
    const rows = g.csv == null ? null : parseMontageCsv(g.csv)
    if (rows) parsed.push({ tab: g.tab, rows }); else missing.push(g.tab)
  }
  return {
    orders: collectMontage(parsed),
    tabs: parsed.map(p => p.tab),
    missing,
    unreadable: parsed.reduce((s, p) => s + p.rows.reduce((a, r) => a + r.unreadable, 0), 0),
  }
}

// Экран открывают часто, а книга меняется редко: держим прочитанное 10 минут.
// force-dynamic страницы отключает кэш fetch, поэтому — в памяти процесса.
let memo: { at: number; book: Promise<MontageBook> } | null = null
export function montageBookCached(ttlMs = 10 * 60_000): Promise<MontageBook> {
  if (!memo || Date.now() - memo.at > ttlMs) {
    const book = loadMontageBook()
    memo = { at: Date.now(), book }
    book.catch(() => { if (memo?.book === book) memo = null })
  }
  return memo.book
}

// ── Сверка с «Маржой» ───────────────────────────────────────────────────────────
// По заказу: «Монтажник» и «Дима» из «Маржи» (сумма всех строк заказа, правки из
// приложения сильнее книги) против «Монтажей» (сумма по всем вкладкам).
export type MarginOrder = { order_no: string; month: string; installer: number | null; dima: number | null }
export type MontageCheck = MarginOrder & {
  montage: MontageEntry | null
  installerState: 'ok' | 'diff' | 'fill' | 'none'   // fill — в «Марже» пусто, в «Монтажах» есть
  dimaState: 'ok' | 'diff' | 'none'
}
const same = (a: number, b: number) => Math.abs(a - b) < 1

export function checkMontage(orders: MarginOrder[], book: Map<string, MontageEntry>): MontageCheck[] {
  return orders.map(o => {
    const m = book.get(orderKey(o.order_no)) ?? null
    const installerState: MontageCheck['installerState'] = !m || m.installers === 0 ? 'none'
      : o.installer == null ? 'fill' : same(o.installer, m.installers) ? 'ok' : 'diff'
    const dimaState: MontageCheck['dimaState'] = !m || m.dima == null ? 'none'
      : o.dima != null && same(o.dima, m.dima) ? 'ok' : 'diff'
    return { ...o, montage: m, installerState, dimaState }
  })
}
