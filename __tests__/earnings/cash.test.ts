import { describe, it, expect } from 'vitest'
import { dayCommissions, monthEnd, payoutSplit, planProgress, workdays } from '@/lib/earnings/cash'
import { DEFAULT_MANAGER_COMMISSION_TIERS as TIERS } from '@/lib/earnings/calculateProgressiveCommission'

const WEEK = [1, 2, 3, 4, 5]

describe('workdays', () => {
  it('октябрь 2026: 22 рабочих дня пн–пт, с 5-го — 20', () => {
    expect(workdays('2026-10-01', monthEnd('2026-10'), WEEK)).toBe(22)
    expect(workdays('2026-10-05', '2026-10-31', WEEK)).toBe(20)
  })
  it('конец месяца и пустой отрезок', () => {
    expect(monthEnd('2026-02')).toBe('2026-02-28')
    expect(workdays('2026-10-05', '2026-10-04', WEEK)).toBe(0)
  })
})

describe('planProgress — план в поступлениях', () => {
  it('сентябрь Александры: план 1 млн, поступило 702 170 к 30.09', () => {
    const p = planProgress({ plan: 1_000_000, cash: 702_170, month: '2026-09', today: '2026-10-01', bookLastDay: '2026-09-30', workDays: WEEK })
    expect(p.pct).toBeCloseTo(70.217, 3)
    expect(p.forecast).toBe(702_170)          // месяц прошёл целиком — прогноз = факт
    expect(p.daysLeft).toBe(0)
    expect(p.needPerDay).toBeNull()
  })
  it('середина месяца: прогноз по темпу внесённых дней, «нужно в день» — с сегодняшнего', () => {
    // 1–9 октября внесены (7 рабочих дней), поступило 350 000; сегодня 12.10 (пн)
    const p = planProgress({ plan: 1_100_000, cash: 350_000, month: '2026-10', today: '2026-10-12', bookLastDay: '2026-10-09', workDays: WEEK })
    expect(p.forecast).toBe(Math.round(350_000 / 7 * 22))
    expect(p.daysLeft).toBe(15)
    expect(p.needPerDay).toBe(Math.round(750_000 / 15))
    expect(p.dataThrough).toBe('2026-10-09')
  })
  it('книга за месяц ещё пустая — прогноза нет, а не ноль', () => {
    const p = planProgress({ plan: 1_000_000, cash: 0, month: '2026-10', today: '2026-10-05', bookLastDay: '2026-09-30', workDays: WEEK })
    expect(p.forecast).toBeNull()
    expect(p.dataThrough).toBeNull()
    expect(p.needPerDay).toBe(50_000)         // 1 000 000 / 20 рабочих дней
  })
  it('плана нет — ни процента, ни «нужно в день»', () => {
    const p = planProgress({ plan: null, cash: 100, month: '2026-10', today: '2026-10-05', bookLastDay: '2026-10-02', workDays: WEEK })
    expect([p.pct, p.needPerDay]).toEqual([null, null])
  })
  it('план перевыполнен — нужно 0 в день', () => {
    const p = planProgress({ plan: 500_000, cash: 600_000, month: '2026-10', today: '2026-10-20', bookLastDay: '2026-10-19', workDays: WEEK })
    expect(p.needPerDay).toBe(0)
  })
})

describe('payoutSplit — выплаты 27-го и 15-го', () => {
  it('ступень по накопленной сумме: вторая выплата добирает разницу', () => {
    const s = payoutSplit(1_500_000, 2_400_000, TIERS)
    expect(s.first).toBe(30_000)               // 2 % с 1,5 млн
    expect(s.total).toBe(40_000 + 10_000)      // 2 % с 2 млн + 2,5 % с 0,4 млн
    expect(s.first + s.second).toBe(s.total)
  })
})

describe('dayCommissions — комиссия, которую принёс день', () => {
  it('сумма комиссий по дням = комиссия месяца', () => {
    const days = [
      { date: '2026-10-02', prepay: 1_900_000, remainder: 0 },
      { date: '2026-10-01', prepay: 50_000, remainder: 0 },
      { date: '2026-10-03', prepay: 0, remainder: 200_000 },
    ]
    const d = dayCommissions(days, TIERS)
    expect(d.map(x => x.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03'])
    expect(d.reduce((s, x) => s + x.commission, 0)).toBe(payoutSplit(0, 2_150_000, TIERS).total)
  })
})
