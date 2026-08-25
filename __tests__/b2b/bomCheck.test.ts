import { describe, it, expect } from 'vitest'
import { checkQuoteBom, checkSavedItems, summarizeIssues, materialPriceKey, type BomCheckItem } from '@/lib/b2b/bomCheck'
import type { FacetPrice } from '@/lib/b2bCalculator'

const facetPrices: FacetPrice[] = [
  { type_mm: 10, cost_price: 300, transport_cost: 50, sale_price: 800, active: true },
  { type_mm: 20, cost_price: 0, transport_cost: 0, sale_price: 1200, active: true },
]

const material = (over: Partial<BomCheckItem['material']> = {}): BomCheckItem['material'] => ({
  name: 'Прозрачное М1', category: 'стекло', thickness: 6, cost_price: 540, active: true, ...over,
})

const ref = { facetPrices }

describe('checkQuoteBom', () => {
  it('нормальная позиция — без замечаний', () => {
    expect(checkQuoteBom([{ material: material(), hasTempering: true }], ref)).toEqual([])
  })

  it('материал без себестоимости — блокирующее замечание', () => {
    const issues = checkQuoteBom([{ material: material({ cost_price: 0 }) }], ref)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ code: 'material_no_cost', severity: 'block', itemIndex: 0 })
    expect(issues[0].detail).toContain('Прозрачное М1 6 мм')
  })

  it('выключенный материал ловится отдельно от нулевой цены', () => {
    const codes = checkQuoteBom([{ material: material({ active: false, cost_price: 0 }) }], ref).map(i => i.code)
    expect(codes).toEqual(['material_inactive', 'material_no_cost'])
  })

  it('закалка на толщине без тарифа', () => {
    const ok = checkQuoteBom([{ material: material({ thickness: 3, cost_price: 350 }), hasTempering: false }], ref)
    expect(ok).toEqual([])
    const bad = checkQuoteBom([{ material: material({ thickness: 3, cost_price: 350 }), hasTempering: true }], ref)
    expect(bad.map(i => i.code)).toEqual(['tempering_no_cost'])
  })

  it('фацет: нет тарифа, нулевая себестоимость и не выбран тип', () => {
    expect(checkQuoteBom([{ material: material(), hasFacet: true, facetTypeMm: 10 }], ref)).toEqual([])
    expect(checkQuoteBom([{ material: material(), hasFacet: true, facetTypeMm: 15 }], ref).map(i => i.code)).toEqual(['facet_no_price'])
    expect(checkQuoteBom([{ material: material(), hasFacet: true, facetTypeMm: 20 }], ref).map(i => i.code)).toEqual(['facet_no_price'])
    expect(checkQuoteBom([{ material: material(), hasFacet: true, facetTypeMm: null }], ref).map(i => i.code)).toEqual(['facet_no_price'])
  })

  it('триплекс без цены триплексации', () => {
    expect(checkQuoteBom([{ material: material(), hasTriplex: true, triplexPrice: { salePerM2: 900, costPerM2: 400 } }], ref)).toEqual([])
    expect(checkQuoteBom([{ material: material(), hasTriplex: true, triplexPrice: null }], ref).map(i => i.code)).toEqual(['triplex_no_price'])
  })

  it('услуги: считаем только те, у которых бывает себестоимость', () => {
    const svc = (over: Record<string, unknown>) => ({ name: 'Услуга', type: 'per_m2' as const, value: 500, cost_price: 200, ...over })
    // надбавка за габарит — percent-услуга, себестоимости не имеет
    expect(checkQuoteBom([{ material: material(), services: [svc({ type: 'percent', cost_price: 0 })] }], ref)).toEqual([])
    // бесплатная услуга (value=0) не считается упущенной себестоимостью
    expect(checkQuoteBom([{ material: material(), services: [svc({ value: 0, cost_price: 0 })] }], ref)).toEqual([])
    const issues = checkQuoteBom([{ material: material(), services: [svc({ name: 'Плёнка', type: 'film', cost_price: 0 })] }], ref)
    expect(issues.map(i => i.code)).toEqual(['service_no_cost'])
    expect(issues[0].detail).toContain('Плёнка')
  })

  it('материал без привязки к прайсу поставщика — мягкое предупреждение', () => {
    const priced = new Set([materialPriceKey('Прозрачное М1', 'стекло')])
    expect(checkQuoteBom([{ material: material() }], { facetPrices, pricedMaterials: priced })).toEqual([])
    const issues = checkQuoteBom([{ material: material({ name: 'Мору САТИН' }) }], { facetPrices, pricedMaterials: priced })
    expect(issues.map(i => [i.code, i.severity])).toEqual([['supplier_price_unmapped', 'warn']])
  })

  it('зеркало и стекло не путаются в ключе привязки', () => {
    expect(materialPriceKey('Тонированное (бронза/графит)', 'зеркало')).toBe('Тонированное (бронза/графит)|mirror')
    expect(materialPriceKey('Тонированное (бронза/графит)', 'тонированное')).toBe('Тонированное (бронза/графит)|glass')
  })

  it('замечания привязаны к номеру позиции', () => {
    const issues = checkQuoteBom([
      { material: material() },
      { material: material({ name: 'Сатин', cost_price: 0 }) },
    ], ref)
    expect(issues.map(i => i.itemIndex)).toEqual([1])
  })
})

describe('checkSavedItems', () => {
  const item = (over: Record<string, unknown> = {}) => ({ materialName: 'Прозрачное М1', thickness: 6, costWithVat: 1000, saleIncVat: 3000, ...over })

  it('нулевая себестоимость при ненулевой продаже — замечание', () => {
    expect(checkSavedItems([item()])).toEqual([])
    expect(checkSavedItems([item({ costWithVat: 0 })]).map(i => i.code)).toEqual(['material_no_cost'])
  })

  it('пустая позиция без продажи не считается проблемой', () => {
    expect(checkSavedItems([item({ costWithVat: 0, saleIncVat: 0 })])).toEqual([])
  })

  it('себестоимость без НДС тоже считается сопоставлением', () => {
    expect(checkSavedItems([{ materialName: 'Прозрачное М1', thickness: 6, costExVat: 830, saleIncVat: 3000 }])).toEqual([])
    expect(checkSavedItems([{ materialName: 'Прозрачное М1', thickness: 6, costExVat: 0, saleIncVat: 3000 }])).toHaveLength(1)
  })
})

describe('summarizeIssues', () => {
  it('считает блокирующие, предупреждения и число позиций', () => {
    const issues = checkQuoteBom([
      { material: { name: 'A', category: 'стекло', thickness: 6, cost_price: 0, active: true } },
      { material: { name: 'B', category: 'стекло', thickness: 6, cost_price: 540, active: true } },
    ], { facetPrices, pricedMaterials: new Set() })
    expect(summarizeIssues(issues)).toEqual({ blocking: 1, warnings: 2, positions: 2 })
  })
})
