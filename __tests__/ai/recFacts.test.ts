import { describe, expect, it } from 'vitest'
import { b2bFacts, managerFacts, marginFacts, monthPeriod, salesFacts, slug } from '@/lib/ai/recFacts'
import { foldStats } from '@/lib/sales/managerStats'
import type { PeriodTotals } from '@/lib/sales/marginBook'

const val = (facts: { id: string; value: number }[], id: string) => facts.find(f => f.id === id)?.value

describe('salesFacts', () => {
  const rows = [
    { sale_date: '2026-09-03', amount: 100_000, manager: 'Яна' },
    { sale_date: '2026-09-20', amount: '50000', manager: 'Яна' },
    { sale_date: '2026-09-21', amount: 30_000, manager: null },
    { sale_date: '2026-08-15', amount: 999_999, manager: 'Яна' },
  ]
  it('сумма, заказы и средний чек — только своего месяца', () => {
    const f = salesFacts(rows, '2026-09', 'last_month')
    expect(val(f, 'sales.sum.last_month')).toBe(180_000)
    expect(val(f, 'sales.count.last_month')).toBe(3)
    expect(val(f, 'sales.avg.last_month')).toBe(60_000)
    expect(f[0].period).toBe('сентябрь 2026')
  })
  it('по менеджерам — только за прошлый месяц; без менеджера — отдельной строкой', () => {
    expect(val(salesFacts(rows, '2026-09', 'last_month'), 'sales.mgr.яна.sum.last_month')).toBe(150_000)
    expect(val(salesFacts(rows, '2026-09', 'last_month'), 'sales.mgr.без_менеджера.count.last_month')).toBe(1)
    expect(salesFacts(rows, '2026-08', 'prev_month').some(x => x.id.startsWith('sales.mgr.'))).toBe(false)
  })
  it('пустой месяц — без среднего чека, а не деление на ноль', () => {
    expect(salesFacts(rows, '2026-07', 'prev_month').map(x => x.id)).toEqual(['sales.sum.prev_month', 'sales.count.prev_month'])
  })
})

describe('marginFacts', () => {
  const t = { objects: 98, closed: 42, open: 56, to_fill: 10, sales: 9e6, closed_sales: 5_469_444, costs: 3_463_001, margin: 2_006_443, margin_pct: 36.68, byCost: {} } as unknown as PeriodTotals
  it('маржа — только закрытые, со своим периодом', () => {
    const f = marginFacts(t, 'июль — сентябрь 2026')
    expect(val(f, 'margin.pct.q')).toBeCloseTo(36.68)
    expect(val(f, 'margin.to_fill.q')).toBe(10)
  })
  it('нет закрытых — процента маржи нет вовсе', () => {
    expect(marginFacts({ ...t, closed_sales: 0, margin_pct: null }, 'x').some(x => x.id === 'margin.pct.q')).toBe(false)
  })
})

describe('managerFacts', () => {
  it('разговор → замер в процентах; «замер → оплата» не даём — оплаты идут и по прошлым замерам', () => {
    const facts = [
      { stat_date: '2026-09-01', manager: 'Айжан', metric: 'talks', value: 62 },
      { stat_date: '2026-09-01', manager: 'Айжан', metric: 'measure_assigned', value: 5 },
      { stat_date: '2026-09-01', manager: 'Айжан', metric: 'measure_done', value: 2 },
      { stat_date: '2026-09-01', manager: 'Айжан', metric: 'payments', value: 5 },
    ]
    const { rows, totals } = foldStats(facts)
    const f = managerFacts(rows, totals, '2026-09')
    expect(val(f, 'mgr.айжан.conv_measure.last_month')).toBe(8)
    expect(val(f, 'mgr.команда.talks.last_month')).toBe(62)
    expect(f.some(x => x.id.includes('conv_payment'))).toBe(false)
  })
})

describe('b2bFacts', () => {
  const rows = [
    { launched_at: '2026-09-10T10:00:00Z', client_name: 'AveoGlass', total_after_discount: 300 },
    { launched_at: '2026-09-11T10:00:00Z', client_name: 'ООО МОНАРХ', total_sale_inc_vat: 500 },
    { launched_at: '2026-09-12T10:00:00Z', client_name: 'MR GLASS', total_after_discount: 200 },
    { launched_at: '2026-09-13T10:00:00Z', client_name: 'M GLASS', total_after_discount: 10_000 },
    { launched_at: '2026-08-31T22:30:00Z', client_name: 'AveoGlass', total_after_discount: 70 },
  ]
  it('без собственной розницы, юрлица клиента склеены, граница месяца по Москве', () => {
    const f = b2bFacts(rows, '2026-09', 'last_month')
    expect(val(f, 'b2b.sum.last_month')).toBe(1070)
    expect(val(f, 'b2b.count.last_month')).toBe(4)
    expect(val(f, 'b2b.clients.last_month')).toBe(2)
    expect(f.find(x => x.id === 'b2b.top_share.last_month')?.label).toContain('MR GLASS')
    expect(val(f, 'b2b.top_share.last_month')).toBeCloseTo(700 / 1070 * 100)
  })
})

describe('мелочи', () => {
  it('slug и подпись периода', () => {
    expect(slug('Семён Петров')).toBe('семен_петров')
    expect(monthPeriod('2026-09')).toBe('сентябрь 2026')
  })
})
