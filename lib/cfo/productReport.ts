import { VAT, effectiveItemTotal, type B2BOrderItem } from '@/lib/b2bCalculator'

// Отчёт по изделиям производства (B2B): что продаём и сколько на этом остаётся — по категории
// материала и внутри неё по материалу/толщине. Идея из чужого КП на ERP (docs/ERP_PROPOSAL_TAKEAWAYS.md, блок 2).
//
// Заказ — запуск (launched_at), как в lib/b2b/analyticsModel.ts. Цена позиции — effectiveItemTotal
// (договорная цена конечна, скидка не трогает индивидуальный прайс), маржа — та же формула, что
// orderMarginPct: без НДС, взвешенная по выручке. Себестоимость — как в просчёте, без невозвратных
// остатков листа: честная экономика с раскроем живёт в /cfo/order-economics.
//
// Рубли округляются ДО сложения — по каждой позиции, поэтому строки складываются в итог до рубля
// и «выручка − себестоимость = маржа» сходится в показанной точности.

export type ReportOrder = {
  id: number
  launched_at: string
  discount_percent: number | null
  total_after_discount: number | null
  total_sale_inc_vat: number | null
  items: unknown
}

export type Agg = {
  key: string
  label: string
  orders: number
  pieces: number
  areaM2: number
  revenueExVat: number
  costExVat: number
  marginRub: number
  marginPct: number | null
  noCostItems: number
  reworkItems: number
  lines: number
}

export type CategoryAgg = Agg & { materials: Agg[] }

export type ProductReport = {
  categories: CategoryAgg[]
  total: Agg
  orders: number
  itemsIncVat: number
  ordersIncVat: number
}

const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : Number(v) || 0)

export function itemsOf(it: unknown): B2BOrderItem[] {
  if (Array.isArray(it)) return it as B2BOrderItem[]
  if (typeof it === 'string') { try { const p = JSON.parse(it); return Array.isArray(p) ? p : [] } catch { return [] } }
  return []
}

const CATEGORY_LABEL: Record<string, string> = {
  'стекло': 'Стекло',
  'зеркало': 'Зеркало',
  'тонированное': 'Тонированное стекло',
  'сатин': 'Сатин',
  'рифленое': 'Рифлёное',
  'изделие': 'Изделия (зеркала с подсветкой, в раме, лофт)',
}
export const categoryLabel = (c: string) => CATEGORY_LABEL[c] ?? (c || 'Без категории')

// Строка второго уровня — материал как он назван в справочнике, плюс закалка: каленое и сырое
// стекло одного названия стоят по-разному и идут разными маршрутами в цехе.
function materialKey(it: B2BOrderItem) {
  const name = String(it.materialName ?? '').trim() || 'Без названия'
  const temp = it.hasTempering ? ' · закалка' : ''
  const trip = it.hasTriplex ? ' · триплекс' : ''
  return name + temp + trip
}

const empty = (key: string, label: string): Agg & { _orders: Set<number> } => ({
  key, label, orders: 0, pieces: 0, areaM2: 0, revenueExVat: 0, costExVat: 0, marginRub: 0,
  marginPct: null, noCostItems: 0, reworkItems: 0, lines: 0, _orders: new Set(),
})

type Acc = ReturnType<typeof empty>

// Маржа считается только по позициям с себестоимостью: позиция с нулём дала бы 100% и подняла
// процент группы. Такие позиции видны счётчиком noCostItems, а не растворяются.
type Line = { orderId: number; pieces: number; area: number; rev: number; cost: number; hasCost: boolean; rework: boolean }

function add(a: Acc, l: Line, mrg: { rev: number; cost: number }) {
  a._orders.add(l.orderId)
  a.lines += 1
  a.pieces += l.pieces
  a.areaM2 += l.area
  a.revenueExVat += l.rev
  a.costExVat += l.cost
  if (!l.hasCost) a.noCostItems += 1
  if (l.rework) a.reworkItems += 1
  if (l.hasCost) { mrg.rev += l.rev; mrg.cost += l.cost }
}

function finish(a: Acc, mrg: { rev: number; cost: number }): Agg {
  const { _orders, ...rest } = a
  return {
    ...rest,
    orders: _orders.size,
    areaM2: Math.round(a.areaM2 * 100) / 100,
    marginRub: a.revenueExVat - a.costExVat,
    marginPct: mrg.rev > 0 ? Math.round((1 - mrg.cost / mrg.rev) * 1000) / 10 : null,
  }
}

export const monthOf = (launchedAt: string) => String(launchedAt).slice(0, 7)

export function buildProductReport(orders: ReportOrder[], opts: { month?: string | null; reworkKeys?: Set<string> } = {}): ProductReport {
  const rework = opts.reworkKeys ?? new Set<string>()
  const cats = new Map<string, { acc: Acc; mrg: { rev: number; cost: number }; mats: Map<string, { acc: Acc; mrg: { rev: number; cost: number } }> }>()
  const total = empty('total', 'Итого')
  const totalMrg = { rev: 0, cost: 0 }
  let itemsIncVat = 0, ordersIncVat = 0, orderCount = 0

  for (const o of orders) {
    if (!o.launched_at) continue
    if (opts.month && monthOf(o.launched_at) !== opts.month) continue
    const items = itemsOf(o.items)
    if (!items.length) continue
    orderCount += 1
    ordersIncVat += num(o.total_after_discount) || num(o.total_sale_inc_vat)
    const disc = num(o.discount_percent)

    items.forEach((it, idx) => {
      // Пустая строка в manualTotal — «договорной цены нет», как в currentItemTotal (lib/b2b/adjustTotal.ts)
      const manual = it.manualTotal == null || (it.manualTotal as unknown) === '' ? null : num(it.manualTotal)
      const inc = effectiveItemTotal({ ...it, saleIncVat: num(it.saleIncVat), manualTotal: manual }, disc)
      itemsIncVat += inc
      const cost = Math.round(num(it.costExVat))
      const line: Line = {
        orderId: o.id,
        pieces: num(it.quantity),
        area: num(it.totalAreaNet),
        rev: Math.round(inc * 100 / (100 + VAT)),
        cost,
        hasCost: cost > 0,
        rework: rework.has(`${o.id}:${idx}`),
      }
      const catKey = String(it.category ?? '').trim()
      let c = cats.get(catKey)
      if (!c) { c = { acc: empty(catKey, categoryLabel(catKey)), mrg: { rev: 0, cost: 0 }, mats: new Map() }; cats.set(catKey, c) }
      const mk = materialKey(it)
      let m = c.mats.get(mk)
      if (!m) { m = { acc: empty(mk, mk), mrg: { rev: 0, cost: 0 } }; c.mats.set(mk, m) }
      add(c.acc, line, c.mrg)
      add(m.acc, line, m.mrg)
      add(total, line, totalMrg)
    })
  }

  const categories: CategoryAgg[] = [...cats.values()]
    .map(c => ({
      ...finish(c.acc, c.mrg),
      materials: [...c.mats.values()].map(m => finish(m.acc, m.mrg)).sort((a, b) => b.revenueExVat - a.revenueExVat),
    }))
    .sort((a, b) => b.revenueExVat - a.revenueExVat)

  return { categories, total: finish(total, totalMrg), orders: orderCount, itemsIncVat, ordersIncVat: Math.round(ordersIncVat) }
}

export function launchMonths(orders: Pick<ReportOrder, 'launched_at' | 'items'>[]): string[] {
  const s = new Set<string>()
  for (const o of orders) if (o.launched_at && itemsOf(o.items).length) s.add(monthOf(o.launched_at))
  return [...s].sort().reverse()
}

// Порог цвета классифицирует показанное значение (одна цифра после запятой), а не сырое.
export function marginTone(pct: number | null): 'red' | 'amber' | 'green' | 'none' {
  if (pct == null) return 'none'
  return pct < 25 ? 'red' : pct < 35 ? 'amber' : 'green'
}
