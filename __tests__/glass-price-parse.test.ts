import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { itemsToGrid } from '@/lib/glassPrice/grid'
import { parseGlassPriceGrid, parsePrice, parseVariant } from '@/lib/glassPrice/parse'
import type { RawPage, ParsedItem } from '@/lib/glassPrice/types'

const pages: RawPage[] = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), '__tests__/fixtures/aig-price-2026-02-10.textitems.json'), 'utf8'),
)
const res = parseGlassPriceGrid(itemsToGrid(pages))

function price(section: RegExp, product: RegExp, thickness: number): number | null | undefined {
  const it = res.items.find((i: ParsedItem) =>
    section.test(i.section) && product.test(i.product) && i.thicknessMm === thickness)
  return it?.pricePerM2
}

describe('parsePrice / parseVariant', () => {
  it('читает цены и «н/д»', () => {
    expect(parsePrice('1 325')).toBe(1325)
    expect(parsePrice('н/д')).toBeNull()
    expect(parsePrice('по запросу')).toBeNull()
    expect(parsePrice('Clear')).toBeUndefined()
  })
  it('читает толщины и коды триплекса', () => {
    expect(parseVariant('4,00 мм')).toEqual({ code: '4', thicknessMm: 4 })
    expect(parseVariant('10,00 мм')).toEqual({ code: '10', thicknessMm: 10 })
    expect(parseVariant('33.1')).toEqual({ code: '33.1', thicknessMm: null })
    expect(parseVariant('Название')).toBeNull()
  })
})

describe('прайс AIG от 10.02.2026', () => {
  it('распознаёт все секции прайса', () => {
    const sections = [...new Set(res.tables.map(t => t.section))]
    expect(sections).toEqual(expect.arrayContaining([
      'Planiglass', 'Phoenix (ФЕНИКС) ®', 'Stratosafe ® (СТРАТОСЕЙФ)',
      'Miroglass ® (МИРОГЛАСС)', 'Lumilac ® (ЛЮМИЛАК)', 'УЗОРЧАТОЕ СТЕКЛО',
    ]))
    expect(res.items.length).toBeGreaterThan(100)
  })

  it('Planiglass: цены по колонкам совпадают с прайсом', () => {
    expect(price(/Planiglass/, /Clear \(M1\)/, 4)).toBe(355)
    expect(price(/Planiglass/, /Clear \(M1\)/, 5)).toBe(451)
    expect(price(/Planiglass/, /Clear \(M1\)/, 6)).toBe(540)
    expect(price(/Planiglass/, /Clear \(M1\)/, 8)).toBe(781)
    expect(price(/Planiglass/, /Clear \(M1\)/, 10)).toBe(959)
    expect(price(/Planiglass/, /^Grey, Bronze$/, 8)).toBe(1400)
    expect(price(/Planiglass/, /^Green$/, 8)).toBe(1576)
    expect(price(/Planiglass/, /Crystalvision/, 10)).toBe(2689)
  })

  it('«н/д» не превращается в цену и не сдвигает колонки', () => {
    expect(price(/Planiglass/, /Crystalvision/, 5)).toBeUndefined()
    expect(price(/Planiglass/, /Clear \(M1\)/, 12)).toBeUndefined()
    // 8 мм Phoenix: пустая Green и цена в Crystalvision — колонки определяются геометрией
    expect(price(/Phoenix/, /Phoenix Green$/, 8)).toBeUndefined()
    expect(price(/Phoenix/, /Phoenix Crystalvision/, 8)).toBe(2628)
  })

  it('Зеркало Miroglass и матовое Decomatt', () => {
    expect(price(/Miroglass/, /^Clear$/, 4)).toBe(730)
    expect(price(/Miroglass/, /^Clear$/, 6)).toBe(1095)
    expect(price(/Miroglass/, /Bronze, Grey/, 4)).toBe(1000)
    expect(price(/Miroglass/, /Mirox on Crystalvision/, 6)).toBe(1770)
    expect(price(/Decomatt/, /^Clear$/, 4)).toBe(740)
    expect(price(/Decomatt/, /Bronze, Grey, Green/, 10)).toBe(2400)
  })

  it('таблицы «Название + Цена за кв.м.» разбираются по строкам', () => {
    const lumilac = res.items.filter(i => /Lumilac ® \(ЛЮМИЛАК\)/.test(i.section))
    expect(lumilac.length).toBe(12)
    expect(lumilac.find(i => i.product === 'Classic Black')?.pricePerM2).toBe(800)
    expect(lumilac.find(i => i.product === 'Classic Grey')?.pricePerM2).toBe(1100)

    const satin = res.items.find(i => /УЗОРЧАТОЕ/.test(i.section) && /САТИН/.test(i.product))
    expect(satin?.pricePerM2).toBe(1500)
    expect(satin?.sheetFormat).toBe('2100х2440')
    const gotik = res.items.find(i => /Готик/.test(i.product))
    expect(gotik?.pricePerM2).toBe(3600)
  })

  it('триплекс: две таблицы в одной строке разделяются по кодам', () => {
    const t331 = res.items.find(i => i.variantCode === '33.1' && /СТРАТОСЕЙФ/.test(i.section) && i.product === 'Clear')
    const t332 = res.items.find(i => i.variantCode === '33.2' && /СТРАТОСЕЙФ/.test(i.section) && i.product === 'Clear')
    expect(t331?.pricePerM2).toBe(1325)
    expect(t332?.pricePerM2).toBe(1720)
  })

  it('строки без цены не попадают в справочник', () => {
    expect(res.items.every(i => typeof i.pricePerM2 === 'number' && i.pricePerM2 > 0)).toBe(true)
    expect(res.items.every(i => i.product.trim().length > 0)).toBe(true)
  })
})
