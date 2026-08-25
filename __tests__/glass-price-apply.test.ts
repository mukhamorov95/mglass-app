import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { itemsToGrid } from '@/lib/glassPrice/grid'
import { parseGlassPriceGrid } from '@/lib/glassPrice/parse'
import { buildApplyPlan, suggestMappings, roundTo } from '@/lib/glassPrice/applyPlan'
import type { MatrixCostRow, Mapping, RawPage } from '@/lib/glassPrice/types'

const fx = (f: string) => JSON.parse(fs.readFileSync(path.join(process.cwd(), '__tests__/fixtures', f), 'utf8'))
const pages: RawPage[] = fx('aig-price-2026-02-10.textitems.json')
const matrix: MatrixCostRow[] = fx('glass-matrix-cost-2026-08-25.json')
const { items } = parseGlassPriceGrid(itemsToGrid(pages))

const mapping = (p: Partial<Mapping>): Mapping => ({
  matrix_name: 'Прозрачное М1', matrix_category: 'glass', thickness: 0,
  section: 'Planiglass', product: 'Clear (M1)', coefficient: 1, rounding: 1, enabled: true, ...p,
})

describe('buildApplyPlan', () => {
  it('меняет только ячейки, где цена прайса отличается от текущей', () => {
    const plan = buildApplyPlan(items, [mapping({})], matrix)
    expect(plan.changes.map(c => [c.thickness, c.old_value, c.new_value])).toEqual([[10, 975, 959]])
    expect(plan.unchanged).toBe(4)                       // 4/5/6/8 мм совпали
    expect(plan.skips.find(s => s.thickness === 12)?.reason).toBe('no_price')
  })

  it('не трогает ячейку, если в новом прайсе цены нет', () => {
    const plan = buildApplyPlan(items, [mapping({})], matrix)
    expect(plan.changes.some(c => c.thickness === 12)).toBe(false)
  })

  it('коэффициент и округление применяются к цене прайса', () => {
    const plan = buildApplyPlan(items, [mapping({ coefficient: 1.1, rounding: 10 })], matrix)
    const t4 = plan.changes.find(c => c.thickness === 4)!
    expect(t4.price_per_m2).toBe(355)
    expect(t4.new_value).toBe(roundTo(355 * 1.1, 10))   // 391 → 390
    expect(t4.old_value).toBe(355)
  })

  it('правило на конкретную толщину важнее правила «все толщины»', () => {
    const plan = buildApplyPlan(items, [
      mapping({}),
      mapping({ thickness: 8, section: 'Planiglass', product: 'Green' }),
    ], matrix)
    // на 8 мм берётся колонка Green (1576), на остальных — Clear (M1)
    expect(plan.changes.find(c => c.thickness === 8)?.new_value).toBe(1576)
    const plan2 = buildApplyPlan(items, [
      mapping({}),
      mapping({ thickness: 8, section: 'Planiglass', product: 'Grey, Bronze' }),
    ], matrix)
    expect(plan2.changes.find(c => c.thickness === 8)?.new_value).toBe(1400)
  })

  it('выключенная привязка ничего не меняет', () => {
    const plan = buildApplyPlan(items, [mapping({ enabled: false })], matrix)
    expect(plan.changes).toHaveLength(0)
  })

  it('нет строки в справочнике — честный skip, а не молчаливое создание', () => {
    const plan = buildApplyPlan(items, [mapping({ matrix_name: 'Небывалое стекло' })], matrix)
    expect(plan.changes).toHaveLength(0)
    expect(plan.skips.every(s => s.reason === 'no_matrix_row')).toBe(true)
  })

  it('непривязанные продукты прайса перечислены', () => {
    const plan = buildApplyPlan(items, [mapping({})], matrix)
    expect(plan.unmappedProducts.some(p => p.product === 'Green')).toBe(true)
    expect(plan.unmappedProducts.some(p => p.product === 'Clear (M1)')).toBe(false)
  })
})

describe('suggestMappings', () => {
  const byName = (n: string, c = 'glass') => suggestMappings(items, matrix).find(s => s.matrix_name === n && s.matrix_category === c)

  it('узнаёт колонки прайса по текущей себестоимости', () => {
    expect(byName('Прозрачное М1')).toMatchObject({ section: 'Planiglass', product: 'Clear (M1)' })
    expect(byName('Сатинированное бесцветное')?.product).toBe('Clear')
    expect(byName('Осветлённое CrystalVision')?.product).toBe('Crystalvision')
    expect(byName('Серебро', 'mirror')).toMatchObject({ section: 'Miroglass ® (МИРОГЛАСС)', product: 'Clear' })
    expect(byName('Осветлённое', 'mirror')?.product).toBe('Mirox on Crystalvision')
  })

  it('совпадение по нескольким толщинам даёт высокий вес', () => {
    const s = byName('Прозрачное М1')!
    expect(s.exact).toBeGreaterThanOrEqual(4)
    expect(s.matched).toEqual(expect.arrayContaining([4, 5, 6, 8]))
  })
})
