import { describe, it, expect } from 'vitest'
import { analyticsDay, isLaunchedRow, managerStats, type AnalyticsOrder } from '@/lib/b2b/analyticsModel'

const row = (o: Partial<AnalyticsOrder>): AnalyticsOrder => ({
  launched_at: null, created_at: '2026-09-10T10:00:00Z', created_by_name: 'Нуржан',
  total_after_discount: null, total_sale_inc_vat: 10_000, margin_percent: null, ...o,
})

describe('B2B аналитика по запуску', () => {
  it('заказ — по колонке launched_at, день выручки — день запуска', () => {
    expect(isLaunchedRow(row({ launched_at: '2026-09-12' }))).toBe(true)
    expect(isLaunchedRow(row({}))).toBe(false)
    expect(analyticsDay(row({ launched_at: '2026-10-01' }))).toBe('2026-10-01')
    expect(analyticsDay(row({ created_at: '2026-09-30T22:30:00Z' }))).toBe('2026-10-01')  // по Москве
  })

  it('менеджеру засчитывается запуск, а не статус: «sent» больше не ноль', () => {
    const stats = managerStats([
      row({ launched_at: '2026-09-12', total_after_discount: 30_000, margin_percent: 30 }),
      row({ launched_at: '2026-09-15', total_sale_inc_vat: 20_000, margin_percent: 20 }),
      row({}),                                                   // просчёт
      row({ created_by_name: null }),
      row({ created_at: '2025-12-30T10:00:00Z', launched_at: '2026-01-05' }),  // другой год создания
    ], 2026)
    expect(stats[0]).toMatchObject({ name: 'Нуржан', kpCount: 3, orderCount: 2, revenue: 50_000, conversion: 67, avgMargin: 25 })
    expect(stats.find(s => s.name === 'Без менеджера')).toMatchObject({ kpCount: 1, orderCount: 0 })
  })
})
