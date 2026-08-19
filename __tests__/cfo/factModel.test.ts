import { describe, it, expect } from 'vitest'
import { computePnl, scenarioPresets, type PnlInput } from '@/lib/cfo/factModel'

const input: PnlInput = {
  revenueLines: [
    { id: 'b2c_mirror',   label: 'Зеркала',  vcPct: 62, revenue: 1_500_000, isActual: false },
    { id: 'b2c_shower',   label: 'Душевые',  vcPct: 62, revenue: 2_000_000, isActual: false },
    { id: 'b2c_loft',     label: 'Лофт',     vcPct: 62, revenue: 1_500_000, isActual: false },
    { id: 'b2c_services', label: 'Монтаж',   vcPct: 25, revenue: 1_300_000, isActual: false },
    { id: 'b2b_glass',    label: 'B2B',      vcPct: 49, revenue: 2_400_000, isActual: false },
    { id: 'other',        label: 'Прочие',   vcPct: 40, revenue: 0,         isActual: false },
  ],
  fixedCosts: [
    { key: 'rent',        label: 'Аренда',     amount: 475_000, isFinancing: false },
    { key: 'utilities',   label: 'Коммуналка', amount: 20_000,  isFinancing: false },
    { key: 'payroll',     label: 'ФОТ',        amount: 800_000, isFinancing: false },
    { key: 'payroll_tax', label: 'Налоги ФОТ', amount: 181_000, isFinancing: false },
    { key: 'leasing',     label: 'Лизинг',     amount: 505_200, isFinancing: true },
    { key: 'credit',      label: 'Кредит',     amount: 344_980, isFinancing: true },
    { key: 'marketing',   label: 'Маркетинг',  amount: 290_000, isFinancing: false },
    { key: 'outsource',   label: 'Аутсорс',    amount: 190_000, isFinancing: false },
    { key: 'other',       label: 'Прочее',     amount: 62_710,  isFinancing: false },
  ],
  taxSystem: 'usn_6',
  profitSplit: { owner: 20, education: 5, reserve: 5 },
  insuranceMonthly: 4_125,
}

describe('computePnl — факт', () => {
  const p = computePnl(input)

  it('выручка = сумма направлений', () => {
    expect(p.revenue).toBe(8_700_000)
  })

  it('маржинальная прибыль = выручка − переменные', () => {
    expect(p.variableCost).toBe(4_601_000)
    expect(p.contribution).toBe(4_099_000)
  })

  it('постоянные = сумма всех статей', () => {
    expect(p.fixedTotal).toBe(2_868_890)
  })

  it('EBITDA = маржинальная − постоянные', () => {
    expect(p.ebitda).toBe(4_099_000 - 2_868_890)
  })

  it('точка безубыточности TB0 положительна и ниже текущей выручки', () => {
    expect(p.tb0).toBeGreaterThan(0)
    expect(p.tb0!).toBeLessThan(p.revenue)
  })

  it('владельцу = 20% чистой прибыли', () => {
    expect(p.fundsOwner).toBe(Math.round(p.netProfit * 0.2))
  })
})

describe('computePnl — сценарий без лизинга и кредита', () => {
  const base = computePnl(input)
  const presets = scenarioPresets(input.fixedCosts)
  const nodebt = presets.find((x) => x.id === 'nodebt')!
  const scen = computePnl(input, nodebt.excluded)

  it('пресет исключает обе долговые статьи', () => {
    expect([...nodebt.excluded].sort()).toEqual(['credit', 'leasing'])
  })

  it('постоянные падают ровно на лизинг + кредит', () => {
    expect(base.fixedTotal - scen.fixedTotal).toBe(505_200 + 344_980)
  })

  it('EBITDA растёт на ту же сумму (выручка не меняется)', () => {
    expect(scen.ebitda - base.ebitda).toBe(850_180)
  })

  it('операционная прибыльность заметно выше', () => {
    expect(scen.ebitdaPct).toBeGreaterThan(base.ebitdaPct)
  })
})
