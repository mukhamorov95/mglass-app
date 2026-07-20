import { describe, it, expect } from 'vitest'
import { simulatePayoff, monthlyLoad, totalDebt, type Obligation } from '@/lib/vlad/debtMath'

const ob = (p: Partial<Obligation>): Obligation => ({
  id: 1, creditor: 'Тест', kind: 'credit', principal: 100_000, rate_pct: 0,
  monthly_payment: 10_000, due_day: null, note: null, closed_at: null, ...p,
})

describe('debtMath', () => {
  it('долг без процентов гасится ровно за principal/payment месяцев', () => {
    const r = simulatePayoff([ob({ principal: 120_000, monthly_payment: 10_000 })], 'avalanche', 0, '2026-07-01')
    expect(r.months).toBe(12)
    expect(r.totalInterest).toBe(0)
  })

  it('проценты удлиняют срок и считаются в totalInterest', () => {
    const r = simulatePayoff([ob({ principal: 120_000, monthly_payment: 10_000, rate_pct: 24 })], 'avalanche', 0, '2026-07-01')
    expect(r.months).toBeGreaterThan(12)
    expect(r.totalInterest).toBeGreaterThan(0)
  })

  it('платёж меньше процентов → долг помечен как stuck', () => {
    const r = simulatePayoff([ob({ principal: 1_000_000, monthly_payment: 1_000, rate_pct: 30 })], 'avalanche', 0, '2026-07-01')
    expect(r.stuck).toContain('Тест')
  })

  it('досрочка сокращает срок', () => {
    const base = simulatePayoff([ob({ principal: 240_000, monthly_payment: 10_000, rate_pct: 20 })], 'avalanche', 0, '2026-07-01')
    const extra = simulatePayoff([ob({ principal: 240_000, monthly_payment: 10_000, rate_pct: 20 })], 'avalanche', 10_000, '2026-07-01')
    expect(extra.months).toBeLessThan(base.months)
    expect(extra.totalInterest).toBeLessThan(base.totalInterest)
  })

  it('avalanche направляет досрочку в самую высокую ставку', () => {
    const obs = [
      ob({ id: 1, creditor: 'Дорогой', principal: 100_000, rate_pct: 30, monthly_payment: 5_000 }),
      ob({ id: 2, creditor: 'Дешёвый', principal: 100_000, rate_pct: 5, monthly_payment: 5_000 }),
    ]
    const r = simulatePayoff(obs, 'avalanche', 20_000, '2026-07-01')
    expect(r.closures[0].creditor).toBe('Дорогой')
  })

  it('snowball направляет досрочку в самый маленький долг', () => {
    const obs = [
      ob({ id: 1, creditor: 'Большой', principal: 500_000, rate_pct: 30, monthly_payment: 15_000 }),
      ob({ id: 2, creditor: 'Маленький', principal: 50_000, rate_pct: 5, monthly_payment: 5_000 }),
    ]
    const r = simulatePayoff(obs, 'snowball', 10_000, '2026-07-01')
    expect(r.closures[0].creditor).toBe('Маленький')
  })

  it('avalanche суммарно дешевле или равен snowball по процентам', () => {
    const obs = [
      ob({ id: 1, creditor: 'А', principal: 300_000, rate_pct: 28, monthly_payment: 10_000 }),
      ob({ id: 2, creditor: 'Б', principal: 80_000, rate_pct: 12, monthly_payment: 5_000 }),
      ob({ id: 3, creditor: 'В', principal: 150_000, rate_pct: 19, monthly_payment: 7_000 }),
    ]
    const a = simulatePayoff(obs, 'avalanche', 15_000, '2026-07-01')
    const s = simulatePayoff(obs, 'snowball', 15_000, '2026-07-01')
    expect(a.totalInterest).toBeLessThanOrEqual(s.totalInterest)
  })

  it('платёж закрытого долга усиливает досрочку (лавина набирает ход)', () => {
    const obs = [
      ob({ id: 1, creditor: 'Первый', principal: 30_000, rate_pct: 10, monthly_payment: 15_000 }),
      ob({ id: 2, creditor: 'Второй', principal: 300_000, rate_pct: 20, monthly_payment: 10_000 }),
    ]
    // без переноса платежа второй долг гасился бы ~41 мес; с переносом — заметно быстрее
    const r = simulatePayoff(obs, 'snowball', 0, '2026-07-01')
    expect(r.months).toBeLessThan(30)
  })

  it('растущая досрочка гасит быстрее фиксированной с той же стартовой суммой', () => {
    const mk = () => [ob({ principal: 600_000, monthly_payment: 15_000, rate_pct: 22 })]
    const flat = simulatePayoff(mk(), 'avalanche', 10_000, '2026-07-01', 0)
    const ramp = simulatePayoff(mk(), 'avalanche', 10_000, '2026-07-01', 5_000)
    expect(ramp.months).toBeLessThan(flat.months)
    expect(ramp.totalInterest).toBeLessThan(flat.totalInterest)
  })

  it('рост досрочки вытягивает даже долг, где платёж не покрывал проценты', () => {
    const r = simulatePayoff([ob({ principal: 500_000, monthly_payment: 1_000, rate_pct: 30 })], 'avalanche', 0, '2026-07-01', 3_000)
    expect(r.months).toBeLessThan(600)
  })

  it('закрытые долги не входят в нагрузку и сумму', () => {
    const obs = [
      ob({ id: 1, principal: 100_000, monthly_payment: 5_000 }),
      ob({ id: 2, principal: 200_000, monthly_payment: 8_000, closed_at: '2026-01-01' }),
    ]
    expect(monthlyLoad(obs)).toBe(5_000)
    expect(totalDebt(obs)).toBe(100_000)
  })
})
