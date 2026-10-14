import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { itemsToGrid } from '@/lib/glassPrice/grid'
import { parseGlassPriceGrid } from '@/lib/glassPrice/parse'
import { buildApplyPlan } from '@/lib/glassPrice/applyPlan'
import type { MatrixCostRow, Mapping, RawPage } from '@/lib/glassPrice/types'

const fx = (f: string) => JSON.parse(fs.readFileSync(path.join(process.cwd(), '__tests__/fixtures', f), 'utf8'))
const pages: RawPage[] = fx('aig-price-2026-10-12.textitems.json')
const { items, warnings } = parseGlassPriceGrid(itemsToGrid(pages))

// Себестоимость в справочнике после применения прайса от 10.02.2026 (прод, 13.10.2026).
const matrix: MatrixCostRow[] = [
  { name: 'Прозрачное М1', category: 'glass', t4: 355, t5: 451, t6: 540, t8: 781, t10: 959, t12: 5700 },
  { name: 'Осветлённое CrystalVision', category: 'glass', t4: 950, t5: null, t6: 1400, t8: 2100, t10: 2689, t12: 10300 },
  { name: 'Серебро', category: 'mirror', t4: 730, t5: 993, t6: 1095, t8: null, t10: null, t12: null },
]

const rule = (p: Partial<Mapping>): Mapping => ({
  matrix_name: 'Прозрачное М1', matrix_category: 'glass', thickness: 0,
  section: 'Planiglass', product: 'Clear (M1)', coefficient: 1, rounding: 1, enabled: true, ...p,
})

const price = (section: string, product: string, t: number) =>
  items.find(i => i.section === section && i.product === product && i.thicknessMm === t)?.pricePerM2

describe('прайс AIG от 12.10.2026', () => {
  it('разбирается без предупреждений, все четыре страницы', () => {
    expect(warnings).toEqual([])
    expect(items.length).toBe(154)
  })

  it('цены сходятся с PDF', () => {
    expect(price('Planiglass', 'Clear (M1)', 4)).toBe(380)
    expect(price('Planiglass', 'Clear (M1)', 12)).toBe(1520)
    expect(price('Planiglass', 'Crystalvision', 4)).toBe(900)
    expect(price('Planiglass', 'Ultra, Китай', 10)).toBe(3500)
    expect(price('Miroglass ® (МИРОГЛАСС)', 'Clear', 4)).toBe(820)
    expect(price('Miroglass ® (МИРОГЛАСС)', 'Mirox on Crystalvision', 6)).toBe(1800)
    expect(price('Decomatt ® (Декомат ех.МАТЕЛЮКС )', 'Clear', 4)).toBe(690)
    expect(price('УЗОРЧАТОЕ СТЕКЛО', 'Ultra, Китай Clear б/ц 19 мм (осв, голубой оттенок)', 19)).toBe(6200)
  })
})

describe('исключение одной толщины', () => {
  it('выключенное правило на 12 мм не даёт правилу «все толщины» переписать ячейку', () => {
    const plan = buildApplyPlan(items, [rule({}), rule({ thickness: 12, enabled: false })], matrix)
    expect(plan.changes.some(c => c.thickness === 12)).toBe(false)
    expect(plan.skips.find(s => s.thickness === 12)?.reason).toBe('excluded')
    expect(plan.changes.map(c => [c.thickness, c.old_value, c.new_value])).toEqual([
      [4, 355, 380], [5, 451, 475], [6, 540, 570], [8, 781, 798], [10, 959, 1026],
    ])
  })

  it('без исключения 12 мм переписывается ценой прайса', () => {
    const plan = buildApplyPlan(items, [rule({})], matrix)
    expect(plan.changes.find(c => c.thickness === 12)).toMatchObject({ old_value: 5700, new_value: 1520 })
  })

  it('включённое правило на толщину по-прежнему важнее правила «все толщины»', () => {
    const plan = buildApplyPlan(items, [rule({}), rule({ thickness: 12, product: 'Crystalvision' })], matrix)
    expect(plan.changes.find(c => c.thickness === 12)?.new_value).toBe(3780)
  })

  it('исключение одной строки не задевает другие строки справочника', () => {
    const plan = buildApplyPlan(items, [
      rule({}), rule({ thickness: 12, enabled: false }),
      rule({ matrix_name: 'Серебро', matrix_category: 'mirror', section: 'Miroglass ® (МИРОГЛАСС)', product: 'Clear' }),
    ], matrix)
    expect(plan.changes.filter(c => c.matrix_name === 'Серебро').map(c => [c.thickness, c.new_value]))
      .toEqual([[4, 820], [5, 1115], [6, 1230]])
  })
})
