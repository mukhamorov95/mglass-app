import { describe, it, expect } from 'vitest'
import {
  isDay, addDays, dayCount, presetPeriod, resolvePeriod, lastYear, bucketOf, bucketKeys, b2bExact,
  split, b2bAll, companySum, avg, byBucket, periodLabel, type B2BSale, type Sale,
} from '@/lib/sales/periodSales'

const TODAY = '2026-10-24'

describe('периоды экрана «Продажи по периодам»', () => {
  it('сегодня и вчера — один день', () => {
    expect(presetPeriod('today', TODAY)).toEqual({ from: TODAY, to: TODAY })
    expect(presetPeriod('yesterday', TODAY)).toEqual({ from: '2026-10-23', to: '2026-10-23' })
    expect(presetPeriod('yesterday', '2026-01-01')).toEqual({ from: '2025-12-31', to: '2025-12-31' })
  })

  it('месяц и год — с начала по сегодня, прошлые — целиком', () => {
    expect(presetPeriod('month', TODAY)).toEqual({ from: '2026-10-01', to: TODAY })
    expect(presetPeriod('year', TODAY)).toEqual({ from: '2026-01-01', to: TODAY })
    expect(presetPeriod('prev_month', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' })
    expect(presetPeriod('prev_month', '2028-03-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
    expect(presetPeriod('prev_year', TODAY)).toEqual({ from: '2025-01-01', to: '2025-12-31' })
  })

  it('свой период: битые даты не проходят, границы меняются местами', () => {
    expect(isDay('2026-02-30')).toBe(false)
    expect(isDay('2028-02-29')).toBe(true)
    expect(resolvePeriod({ from: '2026-09-10', to: '2026-09-01' }, TODAY))
      .toEqual({ preset: 'range', period: { from: '2026-09-01', to: '2026-09-10' } })
    expect(resolvePeriod({ from: '2026-09-10' }, TODAY).period).toEqual({ from: '2026-09-10', to: TODAY })
    expect(resolvePeriod({ to: '2026-09-10' }, TODAY).period).toEqual({ from: '2026-09-10', to: '2026-09-10' })
  })

  it('без параметров и с мусором — текущий месяц', () => {
    expect(resolvePeriod({}, TODAY)).toEqual({ preset: 'month', period: { from: '2026-10-01', to: TODAY } })
    expect(resolvePeriod({ p: 'week', from: 'вчера' }, TODAY).preset).toBe('month')
  })

  it('пресет главнее дат в адресе', () => {
    expect(resolvePeriod({ p: 'today', from: '2026-01-01', to: '2026-02-01' }, TODAY).period).toEqual({ from: TODAY, to: TODAY })
  })

  it('прошлый год — те же даты, 29 февраля → 28-е', () => {
    expect(lastYear({ from: '2026-10-01', to: '2026-10-24' })).toEqual({ from: '2025-10-01', to: '2025-10-24' })
    expect(lastYear({ from: '2028-02-01', to: '2028-02-29' })).toEqual({ from: '2027-02-01', to: '2027-02-28' })
  })

  it('B2B до 2026 года верен только целыми месяцами', () => {
    expect(b2bExact({ from: '2026-10-01', to: TODAY })).toBe(true)
    expect(b2bExact(lastYear({ from: '2026-10-01', to: TODAY }))).toBe(false)          // «Месяц» к 2025
    expect(b2bExact(lastYear(presetPeriod('today', TODAY)))).toBe(false)
    expect(b2bExact(lastYear(presetPeriod('prev_month', TODAY)))).toBe(true)          // сентябрь 2025 целиком
    expect(b2bExact(presetPeriod('prev_year', TODAY))).toBe(true)
    expect(b2bExact({ from: '2025-11-01', to: '2026-01-10' })).toBe(true)              // до 2026 — ноябрь и декабрь целиком
    expect(b2bExact({ from: '2025-11-02', to: '2026-01-10' })).toBe(false)
    expect(b2bExact({ from: '2025-02-01', to: '2025-02-28' })).toBe(true)
  })

  it('до двух месяцев — по дням, дальше — по месяцам', () => {
    expect(dayCount({ from: '2026-10-01', to: '2026-10-24' })).toBe(24)
    expect(bucketOf({ from: '2026-09-01', to: '2026-10-31' })).toBe('day')
    expect(bucketOf({ from: '2026-01-01', to: TODAY })).toBe('month')
    expect(bucketKeys({ from: '2026-10-30', to: '2026-11-02' }, 'day')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'])
    expect(bucketKeys({ from: '2025-11-15', to: '2026-02-01' }, 'month')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
  })

  it('подпись периода', () => {
    expect(periodLabel({ from: TODAY, to: TODAY })).toBe('24 октября 2026')
    expect(periodLabel({ from: '2026-10-01', to: TODAY })).toBe('01.10 — 24.10.2026')
    expect(periodLabel({ from: '2025-12-01', to: '2026-01-31' })).toBe('01.12.2025 — 31.01.2026')
  })
})

describe('суммы M-Glass и B2B', () => {
  const mglass: Sale[] = [
    { date: '2026-10-01', amount: 100_000 },
    { date: '2026-10-02', amount: 50_000.6 },
  ]
  const b2b: B2BSale[] = [
    { date: '2026-10-01', amount: 30_000, own: false },
    { date: '2026-10-01', amount: 20_000.4, own: true },
    { date: '2026-10-03', amount: 10_000, own: false },
    { date: '2026-09-30', amount: 999, own: false },   // вне периода — в строки не попадает
  ]

  it('итог компании — M-Glass плюс B2B внешним, заказы M GLASS не входят', () => {
    const s = split(mglass, b2b.slice(0, 3))
    expect(s.mglass).toEqual({ sum: 150_001, count: 2 })
    expect(s.b2bExternal).toEqual({ sum: 40_000, count: 2 })
    expect(s.b2bOwn).toEqual({ sum: 20_000, count: 1 })
    expect(b2bAll(s)).toEqual({ sum: 60_000, count: 3 })
    expect(companySum(s)).toBe(190_001)
    expect(avg(s.mglass)).toBe(75_001)
    expect(avg({ sum: 0, count: 0 })).toBe(0)
  })

  it('строки по дням сходятся с итогом в рублях', () => {
    const p = { from: '2026-10-01', to: '2026-10-03' }
    const rows = byBucket(mglass, b2b, p)
    expect(rows.map(r => r.key)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03'])
    expect(rows[0].b2bOwn.sum).toBe(20_000)
    const total = split(mglass, b2b.slice(0, 3))
    const sumRows = (f: (r: typeof rows[number]) => number) => rows.reduce((a, r) => a + f(r), 0)
    expect(sumRows(r => r.mglass.sum)).toBe(total.mglass.sum)
    expect(sumRows(r => r.b2bExternal.sum)).toBe(total.b2bExternal.sum)
    expect(sumRows(r => companySum(r))).toBe(companySum(total))
  })
})
