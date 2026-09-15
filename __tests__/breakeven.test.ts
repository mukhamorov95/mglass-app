import { describe, it, expect } from 'vitest'
import {
  analyzeBreakeven, computeBreakeven, combineUnits, withoutDebt, revenueToCover, isDebtRow,
  splitFixed, suggestKind, kindOf, costKey, totalFromName, allocationCheck, companyLevelCosts, companyFixed,
  BREAKEVEN_LABELS, type BreakevenModel,
} from '@/lib/breakeven'
import { computeBe } from '@/lib/cfo/factModel'
import fx from './fixtures/finplan-2026-09-15.json'

// Финмодель из базы на 15.09.2026. Эталонные ТБ сняты старым кодом до объединения
// формул (Ф1) — объединение не должно сдвинуть ни одной цифры.
const mglass = fx.mglass as BreakevenModel
const production = fx.production as BreakevenModel

describe('ТБ по юнитам — те же цифры, что до объединения формул', () => {
  it('M-Glass', () => {
    expect(computeBreakeven(mglass)).toEqual({ revenue: 10_000_000, marginPct: 38, tb0: 3_722_921, tb1: 4_150_414, tbTarget: 4_150_414 })
  })
  it('Производство', () => {
    expect(computeBreakeven(production)).toEqual({ revenue: 4_500_000, marginPct: 60, tb0: 3_616_678, tb1: 3_807_030, tbTarget: 3_807_030 })
  })
  it('Компания 0 и Компания 1 (без кредита и лизинга)', () => {
    const total = combineUnits([production, mglass])
    expect(computeBreakeven(total)).toMatchObject({ revenue: 14_500_000, marginPct: 44.8, tb0: 7_996_676, tb1: 8_701_352 })
    expect(computeBreakeven(withoutDebt(total))).toMatchObject({ tb0: 6_457_446, tb1: 7_026_483 })
  })
})

describe('формулы ТЗ', () => {
  it('операционная ТБ = постоянные / маржинальность', () => {
    expect(revenueToCover(3_000_000, 0.6)).toBe(5_000_000)
  })
  it('с фондами = постоянные / (маржинальность × (1 − доля фондов))', () => {
    expect(revenueToCover(3_000_000, 0.6, 0.25)).toBe(6_666_667)
  })
  it('доход собственника: процент — в знаменателе, фикс — в числителе', () => {
    const m: BreakevenModel = { ...production, ownerPct: 10, ownerRub: 300_000 }
    const a = analyzeBreakeven(m)
    const fixed = a.fixed
    expect(a.tbTarget).toBe(Math.round((fixed + 300_000) / (0.6 * (1 - 0.05 - 0.10))))
  })
  it('маржа не покрывает долю фондов — ТБ нет', () => {
    expect(revenueToCover(1_000_000, 0.4, 1)).toBeNull()
    expect(revenueToCover(1_000_000, 0)).toBeNull()
  })
})

describe('остаток', () => {
  it('вычитает доход собственника', () => {
    const m: BreakevenModel = { ...production, ownerPct: 10, ownerRub: 100_000 }
    const a = analyzeBreakeven(m)
    expect(a.ownerRub).toBe(a.margin * 0.1 + 100_000)
    expect(a.remainder).toBeCloseTo(a.margin - a.fundsRub - a.ownerRub - a.fixed, 6)
  })
  it('без дохода собственника совпадает с прежним «маржа − фонды − постоянные»', () => {
    const a = analyzeBreakeven(production)
    expect(a.remainder).toBeCloseTo(a.margin - a.fundsRub - a.fixed, 6)
  })
})

describe('Компания = сумма юнитов', () => {
  it('рубли фондов и собственника сводки равны сумме юнитов', () => {
    const p = { ...production, ownerPct: 5, ownerRub: 50_000 }
    const g = { ...mglass, ownerPct: 12, ownerRub: 0 }
    const t = analyzeBreakeven(combineUnits([p, g]))
    const ap = analyzeBreakeven(p), ag = analyzeBreakeven(g)
    expect(t.fundsRub).toBeCloseTo(ap.fundsRub + ag.fundsRub, 4)
    expect(t.ownerRub).toBeCloseTo(ap.ownerRub + ag.ownerRub, 4)
    expect(t.fixed).toBe(ap.fixed + ag.fixed)
  })
})

describe('/cfo/model считает ТБ той же формулой', () => {
  it('компания — те же цифры, что на /cfo/breakeven', () => {
    const units = { mglass, production } as Record<string, BreakevenModel>
    const incomes = Object.entries(units).flatMap(([u, m]) => m.incomes.map((i, k) => ({
      id: `${u}_${k}`, label: i.name, unit: u, plan: i.plan, vcPct: i.vars.reduce((s, v) => s + v.pct, 0),
    })))
    const fixed = Object.entries(units).flatMap(([u, m]) => m.fixed.map((f, k) => ({
      key: `${u}_f${k}`, label: f.name, unit: u, amount: f.amount, isDebt: isDebtRow(f.name),
    })))
    const fundsRub = Object.values(units).reduce((s, m) => s + Math.round(analyzeBreakeven(m).fundsRub), 0)
    const be = computeBe({ incomes, fixed, fundsRub })
    expect(be.tb0).toBe(7_996_676)
    expect(be.tb1).toBe(8_701_352)
    expect(be.tbTarget).toBe(8_701_352)
  })
})

it('названия из ТЗ', () => {
  expect(BREAKEVEN_LABELS).toEqual({
    tb0: 'Операционная точка безубыточности',
    tb1: 'Целевая выручка с фондами',
    tbTarget: 'Целевая выручка с доходом собственника',
  })
})

describe('P&L, денежные обязательства и распределение (Ф2)', () => {
  const withLeasing = (patch: object): BreakevenModel => ({
    ...production,
    fixed: production.fixed.map(f => /лизинг/i.test(f.name) ? { ...f, ...patch } : f),
  })

  it('типы по названию — только предложение', () => {
    expect(suggestKind('Лизинг (относится к производству)')).toBe('obligation')
    expect(suggestKind('Кредит и проценты (кредит MGlass)')).toBe('obligation')
    expect(suggestKind('ЗП оклады производства')).toBe('step')
    expect(suggestKind('Банковская комиссия')).toBe('variable')
    expect(suggestKind('Аренда помещения')).toBe('fixed')
    expect(kindOf({ name: 'Аренда', amount: 1 })).toEqual({ kind: 'fixed', suggested: true })
    expect(kindOf({ name: 'Аренда', amount: 1, kind: 'step' })).toEqual({ kind: 'step', suggested: false })
  })

  it('сохранённый тип важнее названия: переименованный лизинг остаётся обязательством', () => {
    const s = splitFixed([{ name: 'Оборудование', amount: 400_000, kind: 'obligation', body: 300_000 }])
    expect(s).toMatchObject({ cash: 400_000, body: 300_000, interest: 100_000, pnl: 100_000 })
  })

  it('пока тело не отделено — цифры как в Ф1 и список неразделённых', () => {
    const a = analyzeBreakeven(production)
    expect(a.split.unsplit).toEqual(['Лизинг (относится к производству)'])
    expect(a.split.pnl).toBe(a.split.cash)
    expect(a.tb0).toBe(3_616_678)
    expect(a.tbCash).toBe(3_616_678)
  })

  it('тело долга не входит в операционную ТБ, но остаётся в денежных целях', () => {
    const a = analyzeBreakeven(withLeasing({ body: 300_000 }))
    expect(a.split).toMatchObject({ cash: 2_170_007, body: 300_000, interest: 100_000, pnl: 1_870_007, unsplit: [] })
    expect(a.tb0).toBe(Math.round(1_870_007 / 0.6))
    expect(a.tbCash).toBe(3_616_678)
    expect(a.tb1).toBe(3_807_030)
    expect(a.remainder).toBeCloseTo(analyzeBreakeven(production).remainder, 6)
  })

  it('амортизация лизинга — расход P&L без денег: в операционную ТБ входит, в денежные цели нет', () => {
    const a = analyzeBreakeven(withLeasing({ body: 300_000, amortization: 50_000 }))
    expect(a.split.pnl).toBe(1_920_007)
    expect(a.split.cash).toBe(2_170_007)
    expect(a.tb1).toBe(3_807_030)
  })

  it('тело больше платежа не делает расход отрицательным', () => {
    expect(splitFixed([{ name: 'Кредит', amount: 100, body: 500 }])).toMatchObject({ body: 100, interest: 0, pnl: 0 })
  })

  it('«без кредитов и лизинга» — по типу, а не по названию', () => {
    const m: BreakevenModel = { ...production, fixed: [
      { name: 'Оборудование в рассрочку', amount: 100, kind: 'obligation' },
      { name: 'Кредитный брокер (услуги)', amount: 50, kind: 'fixed' },
    ] }
    expect(withoutDebt(m).fixed.map(f => f.name)).toEqual(['Кредитный брокер (услуги)'])
  })
})

describe('распределение общих расходов (Ф3)', () => {
  const units = [{ title: 'Производство', fixed: production.fixed }, { title: 'M-Glass', fixed: mglass.fixed }]

  it('ключ статьи без скобок и названия юнита', () => {
    expect(costKey('ЗП оклады M-Glass (офис, продажи, замерщик)')).toBe(costKey('ЗП оклады производства (остаток ФОТ: 1 420к − 390к)'))
    expect(costKey('Аренда помещения (доля от 750 000)')).toBe('аренда помещения')
  })

  it('сумма по компании из названия', () => {
    expect(totalFromName('Аренда помещения (доля от 750 000)')).toBe(750_000)
    expect(totalFromName('ЗП оклады производства (остаток ФОТ: 1 420к − 390к)')).toBe(1_420_000)
    expect(totalFromName('Связь, интернет')).toBeNull()
  })

  it('на данных базы: аренда — 50 000 не распределены, оклады — 20 000, парные статьи без суммы', () => {
    const rows = allocationCheck(units)
    const rent = rows.find(r => r.key === 'аренда помещения')!
    expect(rent).toMatchObject({ allocated: 700_000, total: 750_000, totalSuggested: true, companyLevel: 50_000, status: 'company' })
    const salary = rows.find(r => r.key === 'зп оклады')!
    expect(salary).toMatchObject({ allocated: 1_400_000, total: 1_420_000, companyLevel: 20_000, status: 'company' })
    const bank = rows.find(r => r.key === 'банковская комиссия')!
    expect(bank).toMatchObject({ allocated: 70_000, total: null, status: 'unknown' })
    expect(rows.find(r => r.key.startsWith('лизинг'))).toBeUndefined()
  })

  it('сохранённая сумма важнее названия; перераспределение — «over»', () => {
    const rows = allocationCheck(units, [{ name: 'Аренда помещения', total: 700_000 }, { name: 'Банковская комиссия', total: 50_000 }])
    expect(rows.find(r => r.key === 'аренда помещения')).toMatchObject({ total: 700_000, totalSuggested: false, status: 'ok' })
    expect(rows.find(r => r.key === 'банковская комиссия')).toMatchObject({ status: 'over', companyLevel: 0 })
  })

  it('расходы уровня компании — только по сохранённым суммам', () => {
    expect(companyLevelCosts(allocationCheck(units))).toEqual([])
    const saved = allocationCheck(units, [{ name: 'Аренда помещения', total: 750_000 }])
    expect(companyLevelCosts(saved)).toEqual([{ name: 'Аренда помещения — на уровне компании', amount: 50_000, kind: 'fixed' }])
  })
})

it('companyFixed: остаток общих статей — только по сохранённой сумме', () => {
  const rows = [
    { unit: 'production', data: production }, { unit: 'mglass', data: mglass },
    { unit: 'total', data: { cashBalance: 1, shared: [{ name: 'Аренда помещения', total: 750_000 }] } },
  ]
  const c = companyFixed(rows)
  expect(c.units.map(u => u.title)).toEqual(['Производство', 'M-Glass'])
  expect(c.extra).toEqual([{ name: 'Аренда помещения — на уровне компании', amount: 50_000, kind: 'fixed' }])
  expect(companyFixed(rows.slice(0, 2)).extra).toEqual([])
})
