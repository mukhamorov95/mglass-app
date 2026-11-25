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
