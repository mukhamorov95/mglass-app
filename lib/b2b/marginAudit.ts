import { VAT } from '../b2bCalculator'
import { checkSavedItems, type SavedItemLike } from './bomCheck'

// Аудит маржи по сохранённым просчётам: где итоговая маржа ниже целевой и ПОЧЕМУ.
// A7 ловит нулевую себестоимость на входе; здесь — вторая дыра: цифры реальны, но
// маржа слишком низкая, и это видно только постфактум. Формулы расчёта не трогаем —
// маржа считается ровно так же, как при сохранении просчёта (calculator/b2b): по
// выручке без НДС после скидки. Здесь только читаем сохранённые итоги и раскладываем.

const NET = 100 / (100 + VAT)   // множитель «из цены с НДС в без НДС», как в calcTotals

export type MarginThresholds = {
  target: number   // целевая маржа, financial_settings.default_margin
  green: number    // ≥ green — зелёная
  yellow: number   // yellow..green — жёлтая; < yellow — красная
}

export type MarginCause = 'missing_cost' | 'low_list_price' | 'manager_discount' | 'ok'

export type AuditOrderInput = {
  id: number
  createdAt: string
  clientId: number | null
  clientName: string
  managerName: string | null
  discountPercent: number
  totalCostNet: number       // себестоимость без НДС (total_cost_net)
  totalSaleIncVat: number    // прайсовая сумма до скидки, с НДС
  totalAfterDiscount: number // итог клиенту после скидки, с НДС
  items?: SavedItemLike[]     // для флага «позиции без себестоимости» (пересечение с A7)
}

export type AuditOrder = {
  id: number
  createdAt: string
  clientId: number | null
  clientName: string
  managerName: string | null
  discountPercent: number
  revenueNet: number         // выручка без НДС после скидки
  costNet: number
  marginActual: number | null  // % — итоговая маржа (после скидки)
  marginList: number | null    // % — маржа по прайсу (до скидки)
  color: 'red' | 'amber' | 'green' | 'unknown'
  cause: MarginCause
  gapFromPricePts: number    // на сколько п.п. прайсовая цена ниже целевой
  gapFromDiscountPts: number // на сколько п.п. маржу съела скидка
  undersoldNet: number       // ₽ без НДС — сколько недозаработали до целевой маржи
  missingCostPositions: number
}

export function marginColor(margin: number | null, t: MarginThresholds): AuditOrder['color'] {
  if (margin == null) return 'unknown'
  if (margin < t.yellow) return 'red'
  if (margin < t.green) return 'amber'
  return 'green'
}

function marginOf(costNet: number, revenueNet: number): number | null {
  if (!(revenueNet > 0)) return null
  return Math.round((1 - costNet / revenueNet) * 1000) / 10
}

// Недозаработок: держим себестоимость, поднимаем цену до целевой маржи — насколько
// выросла бы выручка (без НДС). Вся разница — упущенная прибыль.
function undersoldToTarget(costNet: number, revenueNet: number, target: number): number {
  if (!(costNet > 0) || target >= 100) return 0
  const revenueNeeded = costNet / (1 - target / 100)
  return Math.max(0, Math.round(revenueNeeded - revenueNet))
}

export function auditOrder(o: AuditOrderInput, t: MarginThresholds): AuditOrder {
  const revenueNet = Math.round(o.totalAfterDiscount * NET)
  const listNet    = Math.round(o.totalSaleIncVat * NET)
  const costNet    = Math.round(o.totalCostNet)

  const marginActual = marginOf(costNet, revenueNet)
  const marginList   = marginOf(costNet, listNet)
  const missing = o.items ? checkSavedItems(o.items).length : 0

  // Раскладка отставания от цели на два слагаемых: прайс ниже цели vs скидка.
  const gapPrice    = marginList   == null ? 0 : Math.max(0, t.target - marginList)
  const gapDiscount = (marginList == null || marginActual == null) ? 0 : Math.max(0, marginList - marginActual)

  let cause: MarginCause = 'ok'
  if (marginActual != null && marginActual < t.target) {
    if (missing > 0) cause = 'missing_cost'                     // себестоимость неполная → маржа недостоверна
    else if (gapDiscount > gapPrice) cause = 'manager_discount'
    else cause = 'low_list_price'
  }

  return {
    id: o.id, createdAt: o.createdAt, clientId: o.clientId, clientName: o.clientName,
    managerName: o.managerName, discountPercent: o.discountPercent,
    revenueNet, costNet, marginActual, marginList,
    color: marginColor(marginActual, t),
    cause,
    gapFromPricePts: Math.round(gapPrice * 10) / 10,
    gapFromDiscountPts: Math.round(gapDiscount * 10) / 10,
    undersoldNet: cause === 'ok' ? 0 : undersoldToTarget(costNet, revenueNet, t.target),
    missingCostPositions: missing,
  }
}

export const CAUSE_LABEL: Record<MarginCause, string> = {
  missing_cost:     'Позиции без себестоимости',
  low_list_price:   'Низкая цена продажи',
  manager_discount: 'Скидка менеджера',
  ok:               'В норме',
}

export type MarginAuditReport = {
  orders: AuditOrder[]          // только просчёты ниже цели, худшие по деньгам сверху
  totalUndersoldNet: number
  belowTarget: number
  scanned: number
  byCause: { cause: MarginCause; count: number; undersoldNet: number }[]
  byManager: { managerName: string; belowTarget: number; undersoldNet: number; avgMargin: number | null; total: number }[]
  byClient: { clientId: number | null; clientName: string; belowTarget: number; undersoldNet: number }[]
}

export function buildMarginAudit(inputs: AuditOrderInput[], t: MarginThresholds): MarginAuditReport {
  const all = inputs.map(o => auditOrder(o, t))
  const below = all.filter(o => o.marginActual != null && o.marginActual < t.target)
  below.sort((a, b) => b.undersoldNet - a.undersoldNet)

  const causeMap = new Map<MarginCause, { count: number; undersoldNet: number }>()
  for (const o of below) {
    const c = causeMap.get(o.cause) ?? { count: 0, undersoldNet: 0 }
    c.count += 1; c.undersoldNet += o.undersoldNet
    causeMap.set(o.cause, c)
  }

  // Менеджеры: доля/деньги ниже цели считаем по ВСЕМ его просчётам, чтобы видеть,
  // кто уходит в низкую маржу систематически, а не разово.
  const mgr = new Map<string, { below: number; undersold: number; marginSum: number; marginCnt: number; total: number }>()
  for (const o of all) {
    const key = o.managerName || '— без менеджера —'
    const m = mgr.get(key) ?? { below: 0, undersold: 0, marginSum: 0, marginCnt: 0, total: 0 }
    m.total += 1
    if (o.marginActual != null) { m.marginSum += o.marginActual; m.marginCnt += 1 }
    if (o.marginActual != null && o.marginActual < t.target) { m.below += 1; m.undersold += o.undersoldNet }
    mgr.set(key, m)
  }

  const cli = new Map<string, { clientId: number | null; clientName: string; below: number; undersold: number }>()
  for (const o of below) {
    const key = `${o.clientId ?? 'null'}|${o.clientName}`
    const c = cli.get(key) ?? { clientId: o.clientId, clientName: o.clientName, below: 0, undersold: 0 }
    c.below += 1; c.undersold += o.undersoldNet
    cli.set(key, c)
  }

  return {
    orders: below,
    totalUndersoldNet: below.reduce((s, o) => s + o.undersoldNet, 0),
    belowTarget: below.length,
    scanned: all.length,
    byCause: [...causeMap.entries()]
      .map(([cause, v]) => ({ cause, count: v.count, undersoldNet: v.undersoldNet }))
      .sort((a, b) => b.undersoldNet - a.undersoldNet),
    byManager: [...mgr.entries()]
      .map(([managerName, m]) => ({
        managerName, belowTarget: m.below, undersoldNet: m.undersold, total: m.total,
        avgMargin: m.marginCnt > 0 ? Math.round((m.marginSum / m.marginCnt) * 10) / 10 : null,
      }))
      .filter(m => m.belowTarget > 0)
      .sort((a, b) => b.undersoldNet - a.undersoldNet),
    byClient: [...cli.values()]
      .map(c => ({ clientId: c.clientId, clientName: c.clientName, belowTarget: c.below, undersoldNet: c.undersold }))
      .sort((a, b) => b.undersoldNet - a.undersoldNet),
  }
}
