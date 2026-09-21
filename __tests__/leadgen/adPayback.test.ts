import { describe, it, expect } from 'vitest'
import { adShareLimits, adShare, maxCostPerSale } from '@/lib/leadgen/adPayback'

// Строки financial_settings на 21.09.2026
const STANDARD = { default_margin: 40, manager_percent: 3, realization_percent: 3, marketing_percent: 5, transport_percent: 1.5, operation_percent: 6.5 }
const BUDGET = { default_margin: 40, manager_percent: 2, realization_percent: 2, marketing_percent: 3, transport_percent: 2, operation_percent: 7 }

describe('adShareLimits', () => {
  it('стандарт: по плану 5% выручки, до нуля прибыли 26%', () => {
    expect(adShareLimits(STANDARD)).toEqual({ plan: 5, breakEven: 26 })
  })
  it('бюджет: 3% и 27%', () => {
    expect(adShareLimits(BUDGET)).toEqual({ plan: 3, breakEven: 27 })
  })
})

describe('Директ июнь 2025 – март 2026', () => {
  // «Реклама» из ДДС + директолог = 2 101 049 ₽; оплаченные сделки с yclid — 40 на 3 991 467 ₽
  it('реклама съела больше половины выручки канала — вдвое выше нуля прибыли', () => {
    expect(adShare(2_101_049, 3_991_467)!).toBeCloseTo(52.6, 1)
    expect(adShare(2_101_049, 5_600_029)!).toBeCloseTo(37.5, 1)
  })
  it('при чеке ~100 тыс за оплаченную сделку можно было платить до 26 тыс, платили 52,5 тыс', () => {
    expect(Math.round(maxCostPerSale(99_787, 26))).toBe(25_945)
    expect(Math.round(2_101_049 / 40)).toBe(52_526)
  })
})

describe('Авито апрель–июль 2026', () => {
  it('226,5 тыс пополнений на 1 356 875 ₽ выручки — 16,7%: окупается, но выше плана', () => {
    const share = adShare(226_500, 1_356_875)!
    expect(share).toBeCloseTo(16.7, 1)
    const { plan, breakEven } = adShareLimits(STANDARD)
    expect(share).toBeGreaterThan(plan)
    expect(share).toBeLessThan(breakEven)
  })
  it('нулевая выручка — доли нет', () => {
    expect(adShare(1000, 0)).toBeNull()
  })
})
