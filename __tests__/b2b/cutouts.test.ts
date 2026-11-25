import { describe, it, expect } from 'vitest'
import { normalizeCutouts, cutoutProblems, cutoutServices, isCutoutService } from '@/lib/b2b/cutouts'
import { treatmentTags } from '@/lib/b2b/itemTreatments'
import type { B2BService } from '@/lib/types'

const row = (id: number, code: string, value: number, cost: number) =>
  ({ id, code, name: code, type: 'fixed', value, cost_price: cost, description: '', active: true, sort_order: 0 }) as B2BService & { code: string }

describe('вырезы', () => {
  it('складывает одинаковые и отбрасывает пустые', () => {
    expect(normalizeCutouts([{ kind: 'outer', cat: 2, n: 1 }, { kind: 'outer', cat: 2, n: 2 }, { kind: 'inner', cat: 1, n: 0 }, { kind: 'x', cat: 1, n: 3 }]))
      .toEqual([{ kind: 'outer', cat: 2, n: 3 }])
  })
  it('нет цены — проблема, а не ноль', () => {
    expect(cutoutProblems([{ kind: 'outer', cat: 2, n: 1 }], [row(1, 'cutout_outer_2', 0, 0)])).toEqual(['Вырез внешний II кат.: не задана цена'])
    expect(cutoutProblems([{ kind: 'inner', cat: 1, n: 1 }], [])).toEqual(['Вырез внутренний I кат.: нет в справочнике'])
  })
  it('цена за штуку × вырезов на деталь', () => {
    const [s] = cutoutServices([{ kind: 'outer', cat: 2, n: 3 }], [row(7, 'cutout_outer_2', 600, 250)])
    expect(s).toMatchObject({ id: 7, type: 'fixed', value: 1800, cost_price: 750, name: 'Вырез внешний II кат. × 3' })
  })
  it('узнаёт строку выреза по коду и по имени', () => {
    expect(isCutoutService({ code: 'cutout_inner_1' })).toBe(true)
    expect(isCutoutService({ name: 'Вырез внешний I категории' })).toBe(true)
    expect(isCutoutService({ name: 'Триплекс' })).toBe(false)
  })
  it('цех видит вид и категорию, без дубля «вырезы ×N»', () => {
    const tags = treatmentTags({ hasCutouts: true, cutouts: 1, services: [{ id: 7, name: 'Вырез внешний II кат. × 1' }] })
    expect(tags).toContain('вырез внешний II кат. × 1')
    expect(tags.some(t => t.startsWith('вырезы'))).toBe(false)
  })
  it('старая позиция без вида — как раньше', () => {
    expect(treatmentTags({ hasCutouts: true, cutouts: 2 })).toContain('вырезы ×2')
  })
})

import { computeQuoteItem } from '@/lib/b2b/computeQuote'
import { DEFAULT_B2B_RATES } from '@/lib/b2b/rates'
import type { B2BMaterial } from '@/lib/types'

describe('вырез заменяет «Т и Г образные»', () => {
  const mat = { id: 1, name: 'M1', category: 'стекло', thickness: 8, cost_price: 1000, sale_price: 3000, waste_percent: 0, active: true } as unknown as B2BMaterial
  const tg = { id: 11, name: 'Изготовление Т и Г образных изделий', type: 'percent', value: 50, cost_price: 0, description: '', active: true, sort_order: 3 } as B2BService
  const cut = row(29, 'cutout_outer_1', 401, 0)
  const ref = { facetPrices: [], surchargeRules: [], rates: DEFAULT_B2B_RATES, cutoutPrices: [cut] }
  it('с вырезом наценки нет, без выреза — есть', () => {
    const withCut = computeQuoteItem({ material: mat, width: 500, height: 500, quantity: 1, resolvedServices: [tg], cutoutGroups: [{ kind: 'outer', cat: 1, n: 1 }], applyMinPrice: false }, ref)
    expect(withCut.services.map(s => s.name)).toEqual(['Вырез внешний I кат. × 1'])
    const noCut = computeQuoteItem({ material: mat, width: 500, height: 500, quantity: 1, resolvedServices: [tg], applyMinPrice: false }, ref)
    expect(noCut.services.map(s => s.name)).toEqual([tg.name])
  })
})
