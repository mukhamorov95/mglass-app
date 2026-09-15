import { describe, it, expect } from 'vitest'
import {
  analyzeBreakeven, computeBreakeven, combineUnits, withoutDebt, revenueToCover, isDebtRow,
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
