// Ежедневная синхронизация книги владельца «Продажи Мгласс» → crm_sales
// («Продажи M-Glass», /sales). Книга — источник правды: что в ней есть, то и в
// реестре; строку, которой в книге больше нет, реестр гасит (voided), а не удаляет.
//
// Один код для крона (app/api/cron/sales-sheet-sync) и для ручного запуска
// (scripts/import-sales-sheet.mjs). Поэтому здесь только относительные импорты:
// скрипт грузит этот файл самим Node, без сборщика и алиасов.

import type { SupabaseClient } from '@supabase/supabase-js'
import { parseBookTotals, parseStatusTab, parseTab, parseTabList, parseTabMonth } from './salesSheetParse.mjs'

export const SALES_BOOK_ID = '15FavFbEdA_G33k_4ExsuPYF4Xf_eezmGC64OTsTY9vw'
const SUMMARY_GID = '1728905654'          // лист «МГЛАСС»: «Продаж за месяц» по годам
const BATCH = 'gsheet_sales_v2'

// Поля, которые книга задаёт. Остальное в строке реестра (связи с заказом,
// договором, расчётом) синхронизация не трогает.
const FIELDS = [
  'sale_date', 'ready_date', 'department', 'order_no', 'client', 'amount', 'partner_fee',
  'prepayment', 'prepayment_paid', 'remainder_paid', 'payment_method', 'manager', 'status',
  'needs_review', 'ledger_month',
] as const
type Field = typeof FIELDS[number]

export type SheetSale = {
  row: number
  external_key: string
  amount_text: string | null
  ledger_month: string
  sale_date: string
  ready_date: string | null
  department: string
  order_no: string | null
  client: string | null
  amount: number
  partner_fee: number
  prepayment: number
  prepayment_paid: boolean
  remainder_paid: boolean
  payment_method: string
  manager: string | null
  status: string
  needs_review: boolean
}

export type ExistingSale = Partial<Record<Field, unknown>> & {
  id: number
  external_key: string | null
  order_no: string | null
  voided: boolean
}

export type MonthPlan = {
  matched: { sale: SheetSale; row: ExistingSale; changed: Field[]; rekey: boolean; revive: boolean }[]
  inserts: SheetSale[]
  orphans: ExistingSale[]
}

const same = (a: unknown, b: unknown) =>
  (typeof b === 'number' || typeof a === 'number')
    ? Number(a ?? NaN) === Number(b ?? NaN)
    : String(a ?? '') === String(b ?? '')

// Сопоставление строк книги со строками реестра. Сначала по номеру заказа:
// номер строки в книге плывёт, стоит владельцу вставить строку посередине, и
// ключ «вкладка:строка» тогда указывает на чужую продажу. Потом по ключу строки:
// так ловится исправленный в книге номер заказа (0969-2 → 0959-2) — та же
// продажа, не новая. Остальное — новые продажи и лишние строки реестра.
export function planMonth(sales: SheetSale[], existing: ExistingSale[]): MonthPlan {
  const count = (xs: (string | null)[]) => {
    const m = new Map<string, number>()
    for (const x of xs) if (x) m.set(x, (m.get(x) ?? 0) + 1)
    return m
  }
  const sheetNo = count(sales.map(s => s.order_no))
  const sysNo = count(existing.map(r => r.order_no))
  const byNo = new Map(existing.filter(r => r.order_no && sysNo.get(r.order_no) === 1).map(r => [r.order_no!, r]))
  const byKey = new Map(existing.filter(r => r.external_key).map(r => [r.external_key!, r]))

  const used = new Set<number>()
  const pairs = new Map<SheetSale, ExistingSale>()
  for (const s of sales) {
    if (!s.order_no || sheetNo.get(s.order_no) !== 1) continue
    const r = byNo.get(s.order_no)
    if (r && !used.has(r.id)) { pairs.set(s, r); used.add(r.id) }
  }
  for (const s of sales) {
    if (pairs.has(s)) continue
    const r = byKey.get(s.external_key)
    if (r && !used.has(r.id)) { pairs.set(s, r); used.add(r.id) }
  }

  const matched: MonthPlan['matched'] = []
  const inserts: SheetSale[] = []
  for (const s of sales) {
    const r = pairs.get(s)
    if (!r) { inserts.push(s); continue }
    const changed = FIELDS.filter(f => !same(r[f], s[f]))
    matched.push({ sale: s, row: r, changed, rekey: r.external_key !== s.external_key, revive: r.voided })
  }
  return { matched, inserts, orphans: existing.filter(r => !used.has(r.id)) }
}

// Сколько строк реестра месяц может «потерять» за один прогон. Больше — значит,
// скорее сломалось чтение книги, чем владелец удалил полмесяца: гасить не будем,
// скажем в отчёте.
export const orphanLimit = (live: number) => Math.max(3, Math.ceil(live * 0.15))

// Строка книги → колонки crm_sales: номер строки, пометка о тексте и skip
// разбора в базу не идут.
const toRow = (s: SheetSale) => {
  const rest: Record<string, unknown> = { ...s }
  delete rest.row
  delete rest.amount_text
  delete rest.skip
  return rest
}

export type ManagerDiff = { manager: string; sheetCount: number; sheetSum: number; regCount: number; regSum: number }

export type MonthReport = {
  tab: string
  month: string
  sheetCount: number
  sheetSum: number
  bookTotal: number | null
  inserted: { order_no: string | null; manager: string | null; amount: number }[]
  updated: { order_no: string | null; fields: string[] }[]
  revived: number
  voided: { order_no: string | null; client: string | null; manager: string | null; amount: number }[]
  orphansHeld: boolean
  textAmounts: { row: number; order_no: string | null; raw: string; amount: number }[]
  skipped: { row: number; order_no: string | null; prepayment: number }[]
  noDate: (string | null)[]
  dateOutside: { order_no: string | null; sale_date: string }[]
  regCount: number
  regSum: number
  managerDiffs: ManagerDiff[]
  extraInRegistry: { id: number; order_no: string | null; amount: number; source: string | null }[]
}

export type HiddenStatusReport = {
  month: string
  tab: string | null
  closed: number
  changed: { order_no: string | null; closed: boolean }[]
  unknown: string[]
}
export type SyncReport = { dry: boolean; months: MonthReport[]; hidden?: HiddenStatusReport[]; error?: string }

// Со скрытыми вкладками сверяем только статус — маржа считается по закрытым
// объектам, а с января 2026 их ведёт книга «Маржа».
export const HIDDEN_SINCE = '2026-01'

type Fetch = (url: string) => Promise<string>
const defaultFetch: Fetch = async url => {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`HTTP ${r.status} — книга должна быть открыта по ссылке`)
  return r.text()
}

const monthBounds = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  return { from: `${ym}-01`, to: `${next}-01` }
}

export async function syncSalesBook(
  sb: SupabaseClient,
  opts: { dry?: boolean; only?: string[]; since?: string; fetchText?: Fetch } = {},
): Promise<SyncReport> {
  const fetchText = opts.fetchText ?? defaultFetch
  const base = `https://docs.google.com/spreadsheets/d/${SALES_BOOK_ID}`
  const allTabs = (parseTabList(await fetchText(`${base}/htmlview`)) as { name: string; gid: string }[])
    .filter(t => parseTabMonth(t.name))
  const tabs = allTabs
    .filter(t => (opts.only?.length ? opts.only.includes(t.name.trim()) : true))
    .filter(t => (opts.since ? parseTabMonth(t.name)! >= opts.since : true))
  if (tabs.length === 0) return { dry: !!opts.dry, months: [], error: 'В книге не найдено месячных вкладок' }

  const bookTotals = parseBookTotals(await fetchText(`${base}/gviz/tq?tqx=out:csv&gid=${SUMMARY_GID}`)) as Map<string, number>
  const months: MonthReport[] = []

  for (const tab of tabs) {
    const name = tab.name.trim()
    const html = await fetchText(`${base}/htmlview/sheet?headers=true&gid=${tab.gid}`)
    const parsed = parseTab(html, tab.gid, name) as { ledgerMonth: string; sales: SheetSale[]; skipped: { row: number; order_no: string | null; prepayment: number }[] }
    const month = parsed.ledgerMonth
    const sales = parsed.sales

    const { data: ex, error: exErr } = await sb.from('crm_sales')
      .select(['id', 'external_key', 'voided', ...FIELDS].join(', '))
      .eq('import_batch', BATCH).eq('ledger_month', month)
    if (exErr) throw new Error(`${name}: ${exErr.message}`)
    const plan = planMonth(sales, (ex ?? []) as unknown as ExistingSale[])

    const liveOrphans = plan.orphans.filter(r => !r.voided)
    const liveCount = (ex ?? []).filter(r => !(r as unknown as ExistingSale).voided).length
    const orphansHeld = liveOrphans.length > 0 && (sales.length === 0 || liveOrphans.length > orphanLimit(liveCount))
    const toUpdate = plan.matched.filter(m => m.changed.length || m.rekey || m.revive)

    // Подозрение на сломанное чтение книги — месяц не трогаем вовсе.
    if (!opts.dry && !orphansHeld) {
      const now = new Date().toISOString()
      // Ключи строк могут поменяться местами (вставили или удалили строку в
      // книге), а external_key уникален: сначала уводим во временные ключи и
      // переезжающие строки, и лишние, чей ключ теперь занят другой продажей.
      const sheetKeys = new Set(sales.map(s => s.external_key))
      const moving = [
        ...toUpdate.filter(m => m.rekey).map(m => m.row),
        ...plan.orphans.filter(r => r.external_key && sheetKeys.has(r.external_key)),
      ]
      for (const r of moving) {
        const { error } = await sb.from('crm_sales').update({ external_key: `${r.external_key}~${r.id}` }).eq('id', r.id)
        if (error) throw new Error(`${name}: ${error.message}`)
      }
      for (const m of toUpdate) {
        const { error } = await sb.from('crm_sales')
          .update({ ...toRow(m.sale), voided: false, updated_at: now }).eq('id', m.row.id)
        if (error) throw new Error(`${name}, ${m.sale.order_no}: ${error.message}`)
      }
      if (plan.inserts.length) {
        const rows = plan.inserts.map(s => ({ ...toRow(s), source: 'import_gsheet', import_batch: BATCH, created_by: 'Импорт книги' }))
        const { error } = await sb.from('crm_sales').upsert(rows, { onConflict: 'external_key' })
        if (error) throw new Error(`${name}: ${error.message}`)
      }
      if (liveOrphans.length) {
        const { error } = await sb.from('crm_sales')
          .update({ voided: true, updated_at: now }).in('id', liveOrphans.map(r => r.id))
        if (error) throw new Error(`${name}: ${error.message}`)
      }
    }

    // Что покажет экран /sales за этот месяц: он фильтрует по дате продажи, а не
    // по вкладке, и берёт всю розницу, не только строки книги.
    const { from, to } = monthBounds(month)
    const { data: reg, error: regErr } = await sb.from('crm_sales')
      .select('id, order_no, manager, amount, source')
      .gte('sale_date', from).lt('sale_date', to).eq('voided', false).neq('department', 'b2b')
    if (regErr) throw new Error(`${name}: ${regErr.message}`)
    const regRows = (reg ?? []) as { id: number; order_no: string | null; manager: string | null; amount: number; source: string | null }[]

    const byMgr = new Map<string, ManagerDiff>()
    const mgr = (m: string | null) => {
      const k = m || '—'
      if (!byMgr.has(k)) byMgr.set(k, { manager: k, sheetCount: 0, sheetSum: 0, regCount: 0, regSum: 0 })
      return byMgr.get(k)!
    }
    for (const s of sales) { const d = mgr(s.manager); d.sheetCount++; d.sheetSum += s.amount }
    for (const r of regRows) { const d = mgr(r.manager); d.regCount++; d.regSum += Number(r.amount || 0) }

    months.push({
      tab: name,
      month,
      sheetCount: sales.length,
      sheetSum: sales.reduce((s, r) => s + r.amount, 0),
      bookTotal: bookTotals.get(month) ?? null,
      inserted: plan.inserts.map(s => ({ order_no: s.order_no, manager: s.manager, amount: s.amount })),
      updated: toUpdate.filter(m => m.changed.length || m.revive)
        .map(m => ({ order_no: m.sale.order_no, fields: m.revive ? ['возвращена', ...m.changed] : m.changed })),
      revived: toUpdate.filter(m => m.revive).length,
      voided: orphansHeld ? [] : liveOrphans.map(r => ({
        order_no: r.order_no, client: (r.client as string | null) ?? null,
        manager: (r.manager as string | null) ?? null, amount: Number(r.amount ?? 0),
      })),
      orphansHeld,
      textAmounts: sales.filter(s => s.amount_text).map(s => ({ row: s.row, order_no: s.order_no, raw: s.amount_text!, amount: s.amount })),
      skipped: parsed.skipped.map(s => ({ row: s.row, order_no: s.order_no, prepayment: s.prepayment })),
      noDate: sales.filter(s => s.needs_review).map(s => s.order_no),
      dateOutside: sales.filter(s => s.sale_date.slice(0, 7) !== month).map(s => ({ order_no: s.order_no, sale_date: s.sale_date })),
      regCount: regRows.length,
      regSum: regRows.reduce((s, r) => s + Number(r.amount || 0), 0),
      managerDiffs: [...byMgr.values()].filter(d => d.sheetCount !== d.regCount || Math.round(d.sheetSum - d.regSum) !== 0),
      extraInRegistry: regRows.filter(r => r.source !== 'import_gsheet')
        .map(r => ({ id: r.id, order_no: r.order_no, amount: Number(r.amount || 0), source: r.source })),
    })
  }
  const hidden = opts.only?.length ? [] : await syncHiddenStatuses(sb, {
    dry: opts.dry, fetchText,
    since: opts.since && opts.since > HIDDEN_SINCE ? opts.since : HIDDEN_SINCE,
    visible: allTabs.map(t => parseTabMonth(t.name)!),
  })
  return { dry: !!opts.dry, months, hidden }
}

const MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']

// Вкладки января–июня 2026 владелец скрыл: htmlview их не перечисляет, и статусы
// в реестре застыли на 20.07. Скрытый лист отдаёт gviz по имени — CSV без цветов,
// но «Статус» в нём есть. Имя пробуем в двух написаниях книги («Июнь 26»,
// «Январь 2026»); незнакомое имя gviz подменяет первым листом — его отсекает
// проверка шапки в parseStatusTab.
export async function syncHiddenStatuses(
  sb: SupabaseClient,
  opts: { dry?: boolean; since: string; visible: string[]; fetchText?: Fetch },
): Promise<HiddenStatusReport[]> {
  const fetchText = opts.fetchText ?? defaultFetch
  const visible = new Set(opts.visible)
  const last = [...visible].sort().at(-1)
  if (!last) return []
  const months: string[] = []
  for (let m = opts.since; m <= last; m = nextMonth(m)) if (!visible.has(m)) months.push(m)

  const out: HiddenStatusReport[] = []
  for (const month of months) {
    const [y, mo] = month.split('-')
    const names = [`${MONTH_NAMES[Number(mo) - 1]} ${y.slice(2)}`, `${MONTH_NAMES[Number(mo) - 1]} ${y}`]
    let tab: string | null = null
    let rows: { order_no: string; closed: boolean }[] | null = null
    for (const n of names) {
      rows = parseStatusTab(await fetchText(`https://docs.google.com/spreadsheets/d/${SALES_BOOK_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(n)}`))
      if (rows) { tab = n; break }
    }
    if (!rows) { out.push({ month, tab: null, closed: 0, changed: [], unknown: [] }); continue }

    const { data, error } = await sb.from('crm_sales').select('id, order_no, status')
      .eq('import_batch', BATCH).eq('ledger_month', month).eq('voided', false)
    if (error) throw new Error(`${tab}: ${error.message}`)
    const pool = (data ?? []) as { id: number; order_no: string | null; status: string }[]
    const key = (s: string | null) => String(s ?? '').replace(/\s+/g, '').toLowerCase()
    const used = new Set<number>()
    const changed: { id: number; order_no: string | null; closed: boolean }[] = []
    const unknown: string[] = []
    for (const r of rows) {
      const hit = pool.find(p => !used.has(p.id) && key(p.order_no) === key(r.order_no))
      if (!hit) { unknown.push(r.order_no); continue }
      used.add(hit.id)
      if ((hit.status === 'closed') !== r.closed) changed.push({ id: hit.id, order_no: hit.order_no, closed: r.closed })
    }
    if (!opts.dry) {
      const now = new Date().toISOString()
      for (const c of changed) {
        const { error: e } = await sb.from('crm_sales').update({ status: c.closed ? 'closed' : 'open', updated_at: now }).eq('id', c.id)
        if (e) throw new Error(`${tab}, ${c.order_no}: ${e.message}`)
      }
    }
    out.push({ month, tab, closed: rows.filter(r => r.closed).length, changed: changed.map(({ order_no, closed }) => ({ order_no, closed })), unknown })
  }
  return out
}

const nextMonth = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const rub = (n: number) => Math.round(n).toLocaleString('ru-RU').replace(/ /g, ' ') + ' ₽'
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
const monthName = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1] + ' ' + ym.slice(0, 4)

// Месяц сходится, когда экран реестра показывает ровно то, что строки книги.
export const monthOk = (m: MonthReport) =>
  m.regCount === m.sheetCount && Math.round(m.regSum - m.sheetSum) === 0 && m.managerDiffs.length === 0

// Текст для владельца (Telegram, HTML). Коротко, если всё сошлось; подробно —
// только про то, что требует действия.
export function formatSyncReport(r: SyncReport): string {
  if (r.error) return `🧾 <b>Сверка «Продажи Мгласс»</b>\n⚠️ ${r.error}`
  const lines = [`🧾 <b>Сверка «Продажи Мгласс» → реестр</b>${r.dry ? ' (сухой прогон)' : ''}`]
  const fixes: string[] = []
  for (const m of r.months) {
    const changes = m.orphansHeld ? '' : [
      m.inserted.length ? `новых: ${m.inserted.length}` : '',
      m.updated.length ? `изменено: ${m.updated.length}` : '',
      m.voided.length ? `снято: ${m.voided.length}` : '',
    ].filter(Boolean).join(', ')
    const head = `${monthName(m.month)}: ${m.regCount} · ${rub(m.regSum)}`
    // ✏️ — реестр равен строкам книги, но собственный итог книги с ними не
    // сходится: чинить нужно книгу, а не реестр.
    const bookOff = m.bookTotal != null && Math.round(m.bookTotal - m.sheetSum) !== 0
    const icon = !monthOk(m) ? '⚠️' : bookOff ? '✏️' : '✅'
    lines.push(`${icon} ${head}${changes ? ` (${changes})` : ''}`)
    if (!monthOk(m)) {
      lines.push(`   в книге ${m.sheetCount} · ${rub(m.sheetSum)}`)
      for (const d of m.managerDiffs.slice(0, 5)) {
        lines.push(`   ${esc(d.manager)}: книга ${d.sheetCount} · ${rub(d.sheetSum)}, реестр ${d.regCount} · ${rub(d.regSum)}`)
      }
      for (const x of m.extraInRegistry.slice(0, 3)) lines.push(`   в реестре, но не в книге: ${esc(x.order_no ?? '—')} · ${rub(x.amount)}`)
    }
    if (bookOff) {
      lines.push(`   итог книги «Продаж за месяц» ${rub(m.bookTotal!)} — расходится со строками книги на ${rub(m.sheetSum - m.bookTotal!)}`)
    }
    for (const t of m.textAmounts) {
      fixes.push(`${esc(m.tab)}, строка ${t.row}, ${esc(t.order_no ?? '—')}: сумма набрана текстом «${esc(t.raw)}» — формула книги её не считает; в реестре ${rub(t.amount)}`)
    }
    for (const d of m.dateOutside) fixes.push(`${esc(m.tab)}, ${esc(d.order_no ?? '—')}: дата продажи ${d.sale_date} не из этого месяца — на экране продажа уйдёт в другой месяц`)
    if (m.orphansHeld) fixes.push(`${esc(m.tab)}: из книги пропало слишком много строк сразу — реестр не трогал, проверьте книгу`)
    for (const v of m.voided.slice(0, 5)) lines.push(`   снята (нет в книге): ${esc(v.order_no ?? '—')} ${esc(v.client ?? '')} · ${rub(v.amount)}`)
    for (const u of m.updated.slice(0, 5)) lines.push(`   ${esc(u.order_no ?? '—')}: ${u.fields.map(f => FIELD_RU[f] ?? f).join(', ')}`)
  }
  for (const h of r.hidden ?? []) {
    if (!h.tab) { fixes.push(`${monthName(h.month)}: вкладка скрыта и не нашлась по имени — статусы не сверены`); continue }
    const moved = h.changed.length
      ? ` (${h.changed.filter(c => c.closed).length ? `закрыты: ${h.changed.filter(c => c.closed).map(c => esc(c.order_no ?? '—')).slice(0, 8).join(', ')}` : ''}${h.changed.some(c => !c.closed) ? `${h.changed.some(c => c.closed) ? '; ' : ''}снова открыты: ${h.changed.filter(c => !c.closed).map(c => esc(c.order_no ?? '—')).join(', ')}` : ''})`
      : ''
    lines.push(`🙈 ${monthName(h.month)} (вкладка скрыта): закрыто ${h.closed}${moved}`)
    if (h.unknown.length) fixes.push(`${monthName(h.month)}, скрытая вкладка: ${h.unknown.map(esc).join(', ')} — в реестре нет; откройте вкладку, и утренняя сверка их заберёт`)
  }
  if (fixes.length) {
    lines.push('\n✏️ <b>Поправить в книге</b>')
    lines.push(...fixes.map(f => `• ${f}`))
  }
  // Потолок сообщения Telegram — 4096 символов.
  const text = lines.join('\n')
  return text.length > 3900 ? text.slice(0, 3900) + '\n…' : text
}

const FIELD_RU: Record<string, string> = {
  sale_date: 'дата', ready_date: 'готовность', department: 'отдел', order_no: 'номер заказа',
  client: 'клиент', amount: 'сумма', partner_fee: 'партнёрские', prepayment: 'предоплата',
  prepayment_paid: 'оплата предоплаты', remainder_paid: 'оплата остатка', payment_method: 'способ оплаты',
  manager: 'менеджер', status: 'статус', needs_review: 'пометка проверки', ledger_month: 'месяц',
}
