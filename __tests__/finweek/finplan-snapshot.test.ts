import { describe, it, expect } from 'vitest'
import { monthPeriods, buildPeriodPlans, manualFits, defaultSplit } from '@/lib/finweek'
import { snapshotFor, type PlanRow } from '@/lib/finplanSnapshot'

const nov = monthPeriods('2026-11') // 01–04, 05–11, 12–18, 19–25, 26–30 (хвост)

describe('ручная разбивка плана месяца', () => {
  it('предложение по рабочим дням сходится с месяцем до копейки', () => {
    const d = defaultSplit(1_000_000.01, nov)
    expect(Math.round(d.reduce((s, x) => s + x, 0) * 100)).toBe(100_000_001)
  })
  it('несходящаяся на копейку разбивка не принимается', () => {
    const m = nov.map((p, i) => ({ start: p.start, end: p.end, amount: i === 0 ? 199_999.99 : 200_000 }))
    expect(manualFits(1_000_000, nov, m)).toBe(false)
    m[0].amount = 200_000
    expect(manualFits(1_000_000, nov, m)).toBe(true)
  })
  it('разбивка с чужими датами не принимается — берётся предложение', () => {
    const m = nov.map(p => ({ start: p.start, end: p.end, amount: 200_000 }))
    m[1] = { ...m[1], start: '2026-11-06' }
    expect(manualFits(1_000_000, nov, m)).toBe(false)
    const rows = buildPeriodPlans(1_000_000, nov, [], '2026-10-31', m)
    expect(rows.map(r => r.base)).toEqual(defaultSplit(1_000_000, nov))
  })
  it('утверждённая ручная разбивка становится исходным планом', () => {
    const m = nov.map((p, i) => ({ start: p.start, end: p.end, amount: [100_000, 300_000, 300_000, 200_000, 100_000][i] }))
    const rows = buildPeriodPlans(1_000_000, nov, [], '2026-10-31', m)
    expect(rows.map(r => r.base)).toEqual([100_000, 300_000, 300_000, 200_000, 100_000])
  })
})

describe('снимок среды', () => {
  const plan: PlanRow = {
    unit: 'ooo', month: '2026-11', plan_amount: 1_000_000, approved_at: '2026-11-01T10:00:00Z',
    periods: nov.map((p, i) => ({ start: p.start, end: p.end, amount: [100_000, 300_000, 300_000, 200_000, 100_000][i] })),
  }
  const LOAN = 96
  const entries = [
    { entry_date: '2026-11-03', kind: 'in', subfund_id: 1, amount: 50_000 },
    { entry_date: '2026-11-10', kind: 'in', subfund_id: 1, amount: 250_000 },
    { entry_date: '2026-11-10', kind: 'in', subfund_id: LOAN, amount: 500_000 },
    { entry_date: '2026-11-12', kind: 'in', subfund_id: 1, amount: 999_999 }, // после контрольной даты
  ]

  it('не среда и не конец месяца — снимка нет', () => {
    expect(snapshotFor(plan, '2026-11-10', entries, new Set([LOAN]))).toBeNull()
  })
  it('ср 11.11: факт только до контрольной даты, заём отдельно, цели пересмотрены', () => {
    const s = snapshotFor(plan, '2026-11-11', entries, new Set([LOAN]))!
    expect(s).toMatchObject({
      period_start: '2026-11-05', period_end: '2026-11-11', approved: true,
      base_period: 300_000, fact_period: 250_000, non_income_period: 500_000,
      cum_base: 400_000, cum_fact: 300_000, lag: 100_000, remaining: 700_000,
    })
    // 700 000 на оставшиеся по их исходной базе 300:200:100
    expect(s.next_targets).toEqual([350_000, 233_333.33, 116_666.67])
  })
  it('последний день месяца даёт снимок хвоста', () => {
    const s = snapshotFor(plan, '2026-11-30', entries, new Set([LOAN]))!
    expect(s).toMatchObject({ period_start: '2026-11-26', tail: true, next_targets: [] })
  })
})
