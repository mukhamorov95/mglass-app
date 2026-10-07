import { finalTotalOf } from '@/lib/b2b/priceOverride'
import { mskDayKey } from '@/lib/time'

// «B2B Аналитика» по правилу lib/liveOrders.ts (этап 8 docs/SYSTEM_ORDER_ROUTE.md): заказ —
// это запуск, колонка launched_at, а не notes.status. Раньше выручкой считалось всё, что не
// 'quote' (отказы, черновики без статуса), а менеджеру засчитывались только 'confirmed'/'agreed' —
// запуск с июня пишет 'sent', и у всех выходил ноль.

export type AnalyticsOrder = {
  launched_at: string | null
  created_at: string
  created_by_name: string | null
  total_after_discount?: number | null
  total_sale_inc_vat?: number | null
  margin_percent?: number | null
}

export const isLaunchedRow = (o: Pick<AnalyticsOrder, 'launched_at'>) => o.launched_at != null

// День заказа для выручки — день запуска (как в /b2b-orders и отчёте по клиентам); у просчёта — создания.
export const analyticsDay = (o: Pick<AnalyticsOrder, 'launched_at' | 'created_at'>) => mskDayKey(o.launched_at ?? o.created_at)

export type ManagerStat = { name: string; kpCount: number; orderCount: number; revenue: number; conversion: number; avgMargin: number }

// Менеджер — колонка created_by_name. КП — всё созданное за год; из них запущенные — заказы
// и выручка, поэтому конверсия считается по одной когорте.
export function managerStats(orders: AnalyticsOrder[], year: number): ManagerStat[] {
  const map = new Map<string, { name: string; kpCount: number; orderCount: number; revenue: number; margins: number[] }>()
  for (const o of orders) {
    if (Number(mskDayKey(o.created_at).slice(0, 4)) !== year) continue
    const name = o.created_by_name?.trim() || 'Без менеджера'
    const row = map.get(name) ?? { name, kpCount: 0, orderCount: 0, revenue: 0, margins: [] }
    row.kpCount++
    if (isLaunchedRow(o)) {
      row.orderCount++
      row.revenue += finalTotalOf(o)
      if (o.margin_percent != null && o.margin_percent > 0) row.margins.push(o.margin_percent)
    }
    map.set(name, row)
  }
  return [...map.values()]
    .map(r => ({
      name: r.name, kpCount: r.kpCount, orderCount: r.orderCount, revenue: r.revenue,
      conversion: r.kpCount > 0 ? Math.round(r.orderCount / r.kpCount * 100) : 0,
      avgMargin: r.margins.length > 0 ? Math.round(r.margins.reduce((a, b) => a + b) / r.margins.length) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue)
}
