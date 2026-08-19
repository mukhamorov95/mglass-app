import { describe, it, expect } from 'vitest'
import { computeBe, scenarioPresets, isDebtRow, type BeInput } from '@/lib/cfo/factModel'

// Реальная структура из «Точки безубыточности» (finplan_models):
// M-Glass 10 млн @ 62% VC, Производство 4.5 млн @ 40% VC.
// Постоянные суммарно 3 584 717, из них долг (кредит 290к + лизинг 400к) = 690к.
const input: BeInput = {
  incomes: [
    { id: 'mglass_0', label: 'M-Glass — изделия', unit: 'M-Glass', plan: 10_000_000, vcPct: 62 },
    { id: 'production_0', label: 'Производство — стекло', unit: 'Производство', plan: 4_500_000, vcPct: 40 },
  ],
  fixed: [
    { key: 'm0', label: 'Аренда + оклады + прочее', unit: 'M-Glass', amount: 1_124_710, isDebt: false },
    { key: 'm1', label: 'Кредит и проценты', unit: 'M-Glass', amount: 290_000, isDebt: true },
    { key: 'p0', label: 'Аренда + оклады + прочее', unit: 'Производство', amount: 1_770_007, isDebt: false },
    { key: 'p1', label: 'Лизинг', unit: 'Производство', amount: 400_000, isDebt: true },
  ],
  fundsRub: 526_400,
}

describe('computeBe — факт из break-even', () => {
  const p = computeBe(input)

  it('доход = сумма планов юнитов', () => {
    expect(p.revenue).toBe(14_500_000)
  })

  it('переменные и маржа', () => {
    expect(p.variableCost).toBe(8_000_000) // 10м×62% + 4.5м×40%
    expect(p.margin).toBe(6_500_000)
    expect(p.marginPct).toBe(44.8)
  })

  it('постоянные = сумма всех статей', () => {
    expect(p.fixedTotal).toBe(3_584_717)
  })

  it('EBITDA = маржа − постоянные', () => {
    expect(p.ebitda).toBe(6_500_000 - 3_584_717)
  })

  it('остаток = маржа − фонды − постоянные', () => {
    expect(p.remainder).toBe(6_500_000 - 526_400 - 3_584_717)
  })

  it('ТБ-0 положительна и ниже планового дохода', () => {
    expect(p.tb0).toBeGreaterThan(0)
    expect(p.tb0!).toBeLessThan(p.revenue)
  })
})

describe('computeBe — сценарий без кредита и лизинга', () => {
  const base = computeBe(input)
  const nodebt = scenarioPresets(input.fixed).find((x) => x.id === 'nodebt')!
  const scen = computeBe(input, nodebt.excluded)

  it('пресет исключает обе долговые статьи', () => {
    expect([...nodebt.excluded].sort()).toEqual(['m1', 'p1'])
  })

  it('постоянные падают ровно на кредит + лизинг', () => {
    expect(base.fixedTotal - scen.fixedTotal).toBe(290_000 + 400_000)
  })

  it('EBITDA растёт на ту же сумму долга', () => {
    expect(scen.ebitda - base.ebitda).toBe(690_000)
  })
})

describe('isDebtRow', () => {
  it('ловит кредит и лизинг по названию', () => {
    expect(isDebtRow('Кредит и проценты (кредит MGlass)')).toBe(true)
    expect(isDebtRow('Лизинг (относится к производству)')).toBe(true)
    expect(isDebtRow('Аренда помещения')).toBe(false)
  })
})
