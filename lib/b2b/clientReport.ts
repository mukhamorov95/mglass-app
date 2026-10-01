import { canonicalClient, isOwnRetail, orderAmount } from '@/lib/liveOrders'

// Отчёт по клиентам B2B: клиент × период → заказы и суммы (просьба владельца 30.09).
// Правила подсчёта — как в «B2B Заказах» (lib/liveOrders.ts): только запущенные,
// сумма после скидки, дата — дата запуска. Здесь только чистая логика, без базы.
//
// Клиент — не карточка, а группа карточек под одним именем: MR GLASS живёт в трёх
// карточках (CLIENT_ALIASES), и отчёт по нему должен собрать все три.
// У истории 2024–2025 ссылки на карточку почти нет (1614 из 1927 заказов) — такие
// заказы привязываются по точному названию клиента или его юрлица.

export type ReportClientCard = { id: number; name: string; crm_source?: string | null }
export type ReportEntity = { client_id: number; full_name: string | null }
export type ReportOrderRow = {
  id: number
  client_id: number | null
  client_name: string | null
  launched_at: string
  total_after_discount?: number | null
  total_sale_inc_vat?: number | null
}

export type ClientGroup = { key: string; label: string; cardIds: number[]; ownRetail: boolean }
export type Attributed<T extends ReportOrderRow = ReportOrderRow> = T & { groupKey: string; amount: number; byName: boolean }
export type AttributedOrder = Attributed

export const UNKNOWN_KEY = 'unknown'
const UNKNOWN_NAMES = new Set(['', '-', '—', 'БЕЗ КЛИЕНТА', 'КЛИЕНТ НЕ УКАЗАН'])

export const normName = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toUpperCase()

// Ключ группы — каноническое имя: все карточки-псевдонимы одного клиента сходятся в один.
export const groupKeyOf = (name: string | null | undefined) => `c:${normName(canonicalClient(name))}`

export function buildGroups(cards: ReportClientCard[]): Map<string, ClientGroup> {
  const groups = new Map<string, ClientGroup>()
  for (const c of cards) {
    const key = groupKeyOf(c.name)
    const g = groups.get(key)
    if (g) { g.cardIds.push(c.id); continue }
    const canon = canonicalClient(c.name)
    groups.set(key, { key, label: canon === c.name.trim() ? c.name.trim() : canon, cardIds: [c.id], ownRetail: isOwnRetail(c.name) })
  }
  return groups
}

// Название (клиента или его юрлица) → группа. Имя, которое ведёт в две разные
// группы, не привязываем: лучше строка «без карточки», чем чужие деньги в отчёте.
export function buildNameIndex(cards: ReportClientCard[], entities: ReportEntity[]): Map<string, string | null> {
  const byId = new Map(cards.map(c => [c.id, c]))
  const idx = new Map<string, string | null>()
  const put = (name: string | null | undefined, key: string) => {
    for (const n of [normName(name), normName(canonicalClient(name))]) {
      if (!n) continue
      const prev = idx.get(n)
      idx.set(n, prev === undefined || prev === key ? key : null)
    }
  }
  for (const c of cards) put(c.name, groupKeyOf(c.name))
  for (const e of entities) {
    const card = byId.get(e.client_id)
    if (card && e.full_name) put(e.full_name, groupKeyOf(card.name))
  }
  return idx
}

export function attribute<T extends ReportOrderRow>(
  row: T,
  cardsById: Map<number, ReportClientCard>,
  nameIndex: Map<string, string | null>,
): Attributed<T> {
  const amount = orderAmount(row)
  const card = row.client_id != null ? cardsById.get(row.client_id) : undefined
  if (card) return { ...row, amount, groupKey: groupKeyOf(card.name), byName: false }
  const n = normName(row.client_name)
  if (UNKNOWN_NAMES.has(n)) return { ...row, amount, groupKey: UNKNOWN_KEY, byName: false }
  const hit = nameIndex.get(n) ?? nameIndex.get(normName(canonicalClient(row.client_name)))
  if (hit) return { ...row, amount, groupKey: hit, byName: true }
  return { ...row, amount, groupKey: `n:${n}`, byName: false }
}

export type Summary = { orders: number; sum: number; avg: number }

export function summarize(rows: { amount: number }[]): Summary {
  const sum = rows.reduce((s, r) => s + r.amount, 0)
  // Средний чек — по заказам с суммой: нулевые (гарантия, переделка) его не занижают.
  const priced = rows.filter(r => r.amount > 0).length
  return { orders: rows.length, sum, avg: priced ? sum / priced : 0 }
}

export type MonthRow = { month: string; orders: number; sum: number }

export function byMonth(rows: { launched_at: string; amount: number }[]): MonthRow[] {
  const m = new Map<string, MonthRow>()
  for (const r of rows) {
    const key = r.launched_at.slice(0, 7)
    const e = m.get(key) ?? { month: key, orders: 0, sum: 0 }
    e.orders++; e.sum += r.amount
    m.set(key, e)
  }
  return [...m.values()].sort((a, b) => b.month.localeCompare(a.month))
}

export type RankRow = {
  key: string; label: string; orders: number; sum: number; avg: number
  hasCard: boolean; ownRetail: boolean; merged: number
}

export function ranking(rows: AttributedOrder[], groups: Map<string, ClientGroup>): RankRow[] {
  const by = new Map<string, AttributedOrder[]>()
  for (const r of rows) {
    const list = by.get(r.groupKey)
    if (list) list.push(r); else by.set(r.groupKey, [r])
  }
  const out: RankRow[] = []
  for (const [key, list] of by) {
    const g = groups.get(key)
    const s = summarize(list)
    out.push({
      key,
      label: g?.label ?? (key === UNKNOWN_KEY ? 'Клиент не указан' : (list[0].client_name ?? '').trim()),
      orders: s.orders, sum: s.sum, avg: s.avg,
      hasCard: !!g, ownRetail: g?.ownRetail ?? false, merged: g?.cardIds.length ?? 0,
    })
  }
  return out.sort((a, b) => b.sum - a.sum || b.orders - a.orders)
}

// Откуда пришли деньги: заказы периода по источнику клиента (b2b_clients.crm_source).
// Источник группы — метка самой старой карточки, где она стоит: у MR GLASS три карточки.
// Заказ без карточки — отдельная строка: источник у него узнать неоткуда.
export const NO_SOURCE = 'none'
export const NO_CARD = 'no_card'
export type SourceRow = { source: string; clients: number; orders: number; sum: number }

export function bySource(
  rows: AttributedOrder[],
  groups: Map<string, ClientGroup>,
  cardsById: Map<number, ReportClientCard>,
): SourceRow[] {
  const sourceOf = (key: string) => {
    const g = groups.get(key)
    if (!g) return NO_CARD
    const id = [...g.cardIds].sort((a, b) => a - b).find(i => cardsById.get(i)?.crm_source)
    return (id != null && cardsById.get(id)?.crm_source) || NO_SOURCE
  }
  const m = new Map<string, SourceRow & { keys: Set<string> }>()
  for (const r of rows) {
    const src = sourceOf(r.groupKey)
    const e = m.get(src) ?? { source: src, clients: 0, orders: 0, sum: 0, keys: new Set<string>() }
    if (r.groupKey !== UNKNOWN_KEY) e.keys.add(r.groupKey)
    e.orders++; e.sum += r.amount
    m.set(src, e)
  }
  return [...m.values()]
    .map(({ keys, ...e }) => ({ ...e, clients: keys.size }))
    .sort((a, b) => b.sum - a.sum || b.orders - a.orders)
}

// Периоды — по календарю Москвы; ключи дат YYYY-MM-DD, обе границы включительно.
export type Period = { from: string; to: string }
export type PresetId = 'month' | 'prev_month' | 'quarter' | 'year' | 'prev_year' | 'all'

const pad = (n: number) => String(n).padStart(2, '0')
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

export function presetPeriod(id: PresetId, today: string): Period {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7))
  switch (id) {
    case 'month': return { from: `${y}-${pad(m)}-01`, to: today }
    case 'prev_month': {
      const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1
      return { from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${pad(lastDay(py, pm))}` }
    }
    case 'quarter': return { from: `${y}-${pad(Math.floor((m - 1) / 3) * 3 + 1)}-01`, to: today }
    case 'year': return { from: `${y}-01-01`, to: today }
    case 'prev_year': return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` }
    case 'all': return { from: '2000-01-01', to: today }
  }
}

export const isDayKey = (s: unknown): s is string =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
