// Розничный заказ по фондам (Э6, docs/configurator/SHOWROOM_COST_ROUTE.md). Модуль не назначает
// цену — раскладывает уже назначенную: закупка, сдельная оплата, налог, продажи и «Остаётся с заказа».
// Ставки — cfo_settings.order_funds (слова владельца 01.10.2026). Нет ставки или себестоимости —
// значение null и запись в missing, а не 0: ноль сделал бы статью бесплатной и раздул остаток.

export type DeliveryZone = 'moscow' | 'region'

export type OrderFundRates = {
  asOf: string | null
  drawingPerShower: number | null
  measurePerShower: number | null
  installPerGlass: number | null
  deliveryPerOrder: Record<DeliveryZone, number | null>
  taxPct: number | null
  managerPct: number | null
  realizationPct: number | null
  partnerReservePct: number | null
  partnerKnownPct: number | null
  otherPct: number | null
}

export const RATE_LABELS = {
  drawingPerShower: 'Чертёж конструктора, ₽ за душевую',
  measurePerShower: 'Замер, ₽ за душевую',
  installPerGlass: 'Монтаж, ₽ за стекло',
  deliveryMoscow: 'Доставка по Москве, ₽ за заказ',
  deliveryRegion: 'Доставка по Подмосковью, ₽ за заказ',
  taxPct: 'Налог, % чека',
  managerPct: 'Менеджер, % чека',
  realizationPct: 'Отдел реализации, % чека',
  partnerReservePct: 'Партнёр (резерв), % чека',
  partnerKnownPct: 'Известный партнёр, % чека',
  otherPct: 'Прочие, % чека',
} as const

export const ZONE_LABELS: Record<DeliveryZone, string> = { moscow: 'Москва', region: 'Подмосковье' }

function rate(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) && n >= 0 ? n : null
}

// Налог фонда — из режима налогообложения настроек CFO, один источник с /admin/cfo (решение
// владельца 02.10: «6%, как в cfo_settings»). Процентом чека выражается только УСН 6%; у УСН 15%
// и ОСНО налог считается от прибыли и НДС — тогда берётся ставка фонда, если владелец её задал.
export const TAX_SYSTEM_CHECK_PCT: Record<string, number> = { usn_6: 6 }
export const TAX_SYSTEM_LABEL: Record<string, string> = { usn_6: 'ИП УСН 6%', usn_15: 'ИП УСН 15%', osno: 'ООО ОСНО' }

export function applyTaxSystem(rates: OrderFundRates, system: unknown): { rates: OrderFundRates; taxSource: string | null } {
  const key = typeof system === 'string' ? system : ''
  const fromSystem = TAX_SYSTEM_CHECK_PCT[key]
  if (fromSystem != null) return { rates: { ...rates, taxPct: fromSystem }, taxSource: `режим «${TAX_SYSTEM_LABEL[key]}» в настройках CFO` }
  return { rates, taxSource: rates.taxPct != null ? 'ставка фонда' : null }
}

// Колонка хранит плоский snake_case JSON: {as_of, drawing_per_shower, …, other_pct}.
export function parseOrderFundRates(raw: unknown): OrderFundRates {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const asOf = typeof o.as_of === 'string' && /^\d{4}-\d{2}-\d{2}/.test(o.as_of) ? o.as_of.slice(0, 10) : null
  return {
    asOf,
    drawingPerShower: rate(o.drawing_per_shower),
    measurePerShower: rate(o.measure_per_shower),
    installPerGlass: rate(o.install_per_glass),
    deliveryPerOrder: { moscow: rate(o.delivery_moscow_per_order), region: rate(o.delivery_region_per_order) },
    taxPct: rate(o.tax_pct),
    managerPct: rate(o.manager_pct),
    realizationPct: rate(o.realization_pct),
    partnerReservePct: rate(o.partner_reserve_pct),
    partnerKnownPct: rate(o.partner_known_pct),
    otherPct: rate(o.other_pct),
  }
}

export function serializeOrderFundRates(r: OrderFundRates): Record<string, number | string | null> {
  return {
    as_of: r.asOf,
    drawing_per_shower: r.drawingPerShower,
    measure_per_shower: r.measurePerShower,
    install_per_glass: r.installPerGlass,
    delivery_moscow_per_order: r.deliveryPerOrder.moscow,
    delivery_region_per_order: r.deliveryPerOrder.region,
    tax_pct: r.taxPct,
    manager_pct: r.managerPct,
    realization_pct: r.realizationPct,
    partner_reserve_pct: r.partnerReservePct,
    partner_known_pct: r.partnerKnownPct,
    other_pct: r.otherPct,
  }
}

// Округление набора долей до целых с сохранением суммы: каждое значение отходит от своей
// доли меньше чем на единицу, остаток раздаётся по наибольшим дробным частям.
export function roundPreservingSum(values: number[]): number[] {
  const target = Math.round(values.reduce((s, v) => s + v, 0))
  const base = values.map(v => Math.floor(v))
  let rest = target - base.reduce((s, v) => s + v, 0)
  const order = values.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (let k = 0; rest > 0 && k < order.length; k++, rest--) base[order[k].i] += 1
  return base
}

export function allocate(total: number, weights: number[]): number[] {
  const w = weights.reduce((s, x) => s + x, 0)
  if (!(w > 0)) return weights.map(() => 0)
  return roundPreservingSum(weights.map(x => total * x / w))
}

// Доставка — одна на заказ, делится поровну на изделия заказа; рубли остатка уходят первым изделиям.
export function splitDelivery(total: number, itemCount: number): number[] {
  const n = Math.max(0, Math.floor(itemCount))
  return n > 0 ? allocate(Math.round(total), Array(n).fill(1)) : []
}

// Налог, продажи и цель — доли одной конечной цены, поэтому складываются в одном знаменателе.
export function priceForTarget(p: { materials: number; piecework: number; taxPct: number; salesPct: number; targetPct: number }): number | null {
  const cost = p.materials + p.piecework
  const keepPct = 100 - p.taxPct - p.salesPct - p.targetPct
  if (!(cost > 0) || !(keepPct > 0)) return null
  return Math.round(cost * 100 / keepPct)
}

export type MaterialKey = 'glass' | 'hardware' | 'materials'
export const MATERIAL_LABELS: Record<MaterialKey, string> = { glass: 'Стекло', hardware: 'Фурнитура', materials: 'Стекло и фурнитура' }

export type FundItemInput = {
  label: string
  kind?: 'shower' | 'other'
  price: number
  materials: { key: MaterialKey; amount: number | null }[]
  materialsSource?: string
  glassCount: number | null
  glassCountSource?: string
}

export type FundKey = 'materials' | 'piecework' | 'tax' | 'sales'
export type FundLine = { key: string; label: string; amount: number | null; note?: string }
export type Fund = { key: FundKey; label: string; amount: number | null; pct: number | null; lines: FundLine[] }

export type ItemFunds = {
  label: string
  kind: 'shower' | 'other'
  price: number
  materialsSource?: string
  glassCountSource?: string
  funds: Fund[]
  directCost: number | null
  remains: number | null
  remainsPct: number | null
  priceForTarget: number | null
  missing: string[]
}

export type OrderFundsOptions = {
  deliveryZone: DeliveryZone
  partner?: { pct?: number | null } | null
  targetPct?: number | null
}

export type OrderFundsResult = {
  items: ItemFunds[]
  deliveryZone: DeliveryZone
  deliveryTotal: number | null
  partnerKnown: boolean
  partnerPct: number | null
  targetPct: number | null
  missing: string[]
}

const FUND_LABELS: Record<FundKey, string> = {
  materials: 'Закупка материалов',
  piecework: 'Сдельная оплата',
  tax: 'Налог',
  sales: 'Продажи и реализация',
}

const rub = (n: number) => Math.round(n).toLocaleString('ru-RU')
const sumOrNull = (xs: (number | null)[]) => xs.some(x => x == null) ? null : (xs as number[]).reduce((s, x) => s + x, 0)

type ItemCtx = {
  deliveryShare: number | null
  deliveryNote: string
  partnerPct: number | null
  partnerNote: string
  orderMissing: string[]
  targetPct: number | null
}

function itemFunds(item: FundItemInput, rates: OrderFundRates, ctx: ItemCtx): ItemFunds {
  const { deliveryShare, deliveryNote, partnerPct, partnerNote, targetPct } = ctx
  const missing: string[] = [...ctx.orderMissing]
  const price = Math.round(item.price)

  const matLines: FundLine[] = item.materials.length
    ? item.materials.map(m => ({ key: m.key, label: MATERIAL_LABELS[m.key], amount: m.amount == null || !Number.isFinite(m.amount) ? null : Math.round(m.amount) }))
    : [{ key: 'materials', label: MATERIAL_LABELS.materials, amount: null }]
  if (matLines.some(l => l.amount == null)) missing.push('себестоимость не сохранена')

  const glass = item.glassCount != null && item.glassCount > 0 ? item.glassCount : null
  if (glass == null) missing.push('число стёкол')
  const need = (v: number | null, label: string) => { if (v == null) missing.push(label); return v }
  const drawing = need(rates.drawingPerShower, RATE_LABELS.drawingPerShower)
  const measure = need(rates.measurePerShower, RATE_LABELS.measurePerShower)
  const install = need(rates.installPerGlass, RATE_LABELS.installPerGlass)
  const pieceLines: FundLine[] = [
    { key: 'drawing', label: 'Чертёж конструктора', amount: drawing },
    { key: 'measure', label: 'Замер', amount: measure },
    { key: 'install', label: 'Монтаж', amount: install != null && glass != null ? Math.round(install * glass) : null,
      note: glass != null && install != null ? `${glass} ст. × ${rub(install)} ₽` : undefined },
    { key: 'delivery', label: 'Доставка', amount: deliveryShare, note: deliveryNote },
  ]

  const taxPct = need(rates.taxPct, RATE_LABELS.taxPct)
  const taxLines: FundLine[] = [{ key: 'tax', label: 'Налог', amount: taxPct != null ? Math.round(price * taxPct / 100) : null, note: taxPct != null ? `${taxPct}% чека` : undefined }]

  const salesDefs = [
    { key: 'manager', label: 'Менеджер', pct: need(rates.managerPct, RATE_LABELS.managerPct) },
    { key: 'realization', label: 'Отдел реализации', pct: need(rates.realizationPct, RATE_LABELS.realizationPct) },
    { key: 'partner', label: 'Партнёр', pct: partnerPct, note: partnerNote },
    { key: 'other', label: 'Прочие', pct: need(rates.otherPct, RATE_LABELS.otherPct) },
  ]
  // Фонд округляется целиком, строки — делёж фонда: так фонд = своя доля чека до рубля.
  const salesPcts = salesDefs.map(d => d.pct)
  const salesPctSum = sumOrNull(salesPcts)
  const salesAmounts = salesPctSum != null
    ? allocate(Math.round(price * salesPctSum / 100), salesPcts as number[])
    : salesPcts.map(p => p == null ? null : Math.round(price * p / 100))
  const salesLines: FundLine[] = salesDefs.map((d, i) => ({
    key: d.key, label: d.label, amount: salesAmounts[i],
    note: d.note ?? (d.pct != null ? `${d.pct}% чека` : undefined),
  }))

  const funds: Fund[] = ([
    ['materials', matLines], ['piecework', pieceLines], ['tax', taxLines], ['sales', salesLines],
  ] as [FundKey, FundLine[]][]).map(([key, lines]) => ({ key, label: FUND_LABELS[key], amount: sumOrNull(lines.map(l => l.amount)), pct: null, lines }))

  const fundSum = sumOrNull(funds.map(f => f.amount))
  const remains = fundSum != null ? price - fundSum : null

  // Доли показываются с точностью 0,1 и в сумме дают 100,0 — иначе строка «% чека» не сходится.
  let remainsPct: number | null = null
  if (price > 0 && remains != null) {
    const tenths = roundPreservingSum([...funds.map(f => (f.amount as number) / price * 1000), remains / price * 1000])
    funds.forEach((f, i) => { f.pct = tenths[i] / 10 })
    remainsPct = tenths[funds.length] / 10
  } else if (price > 0) {
    funds.forEach(f => { f.pct = f.amount != null ? Math.round(f.amount / price * 1000) / 10 : null })
  }

  const directCost = sumOrNull([funds[0].amount, funds[1].amount])
  const ptarget = directCost != null && taxPct != null && salesPctSum != null && targetPct != null
    ? priceForTarget({ materials: funds[0].amount as number, piecework: funds[1].amount as number, taxPct, salesPct: salesPctSum, targetPct })
    : null

  return {
    label: item.label, kind: 'shower', price,
    materialsSource: item.materialsSource, glassCountSource: item.glassCountSource,
    funds, directCost, remains, remainsPct, priceForTarget: ptarget,
    missing: [...new Set(missing)],
  }
}

export function orderFunds(items: FundItemInput[], rates: OrderFundRates, opts: OrderFundsOptions): OrderFundsResult {
  const zone = opts.deliveryZone
  const deliveryTotal = rates.deliveryPerOrder[zone]
  const shares = deliveryTotal != null ? splitDelivery(deliveryTotal, items.length) : items.map(() => null)
  const deliveryNote = deliveryTotal != null
    ? `${rub(deliveryTotal)} ₽ на заказ (${ZONE_LABELS[zone]}) ÷ ${items.length} изд.`
    : `нет ставки: ${ZONE_LABELS[zone]}`

  const partnerKnown = opts.partner != null
  const partnerPct = partnerKnown ? (opts.partner?.pct ?? rates.partnerKnownPct) : rates.partnerReservePct
  const partnerNote = partnerPct == null
    ? 'нет ставки'
    : partnerKnown ? `известный партнёр, ${partnerPct}% чека` : `резерв ${partnerPct}% чека`
  const targetPct = opts.targetPct ?? null
  const orderMissing = [
    ...(partnerPct == null ? [partnerKnown ? RATE_LABELS.partnerKnownPct : RATE_LABELS.partnerReservePct] : []),
    ...(deliveryTotal == null ? [zone === 'moscow' ? RATE_LABELS.deliveryMoscow : RATE_LABELS.deliveryRegion] : []),
  ]

  const out = items.map((item, i): ItemFunds => item.kind === 'other'
    ? { label: item.label, kind: 'other', price: Math.round(item.price), funds: [], directCost: null, remains: null, remainsPct: null, priceForTarget: null, missing: [] }
    : itemFunds(item, rates, { deliveryShare: shares[i] ?? null, deliveryNote, partnerPct, partnerNote, orderMissing, targetPct }))

  const missing = [...new Set([...orderMissing, ...out.flatMap(it => it.missing)])]
  return { items: out, deliveryZone: zone, deliveryTotal, partnerKnown, partnerPct, targetPct, missing }
}
