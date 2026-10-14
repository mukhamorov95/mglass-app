import { describe, it, expect } from 'vitest'
import { buildProductReport, launchMonths, marginTone, type ReportOrder } from '@/lib/cfo/productReport'
import { orderMarginPct, type B2BOrderItem } from '@/lib/b2bCalculator'

const item = (p: Record<string, unknown>) => ({
  materialName: 'Стекло Осветлённое 8 мм', category: 'стекло', thickness: 8, quantity: 1,
  hasTempering: true, totalAreaNet: 1, saleIncVat: 12200, costExVat: 6000, ...p,
})

const order = (id: number, items: unknown[], p: Partial<ReportOrder> = {}): ReportOrder => ({
  id, launched_at: '2026-09-10', discount_percent: 0, total_after_discount: null, total_sale_inc_vat: null, items, ...p,
})

describe('отчёт по изделиям', () => {
  it('маржа категории = та же формула, что orderMarginPct по тем же позициям', () => {
    const items = [item({}), item({ saleIncVat: 30500, costExVat: 9000, totalAreaNet: 2 })]
    const r = buildProductReport([order(1, items, { discount_percent: 10 })])
    const glass = r.categories[0]
    expect(Math.round(glass.marginPct!)).toBe(orderMarginPct(items as B2BOrderItem[], 10))
  })

  it('договорная цена конечна: скидка заказа её не трогает; пустая строка — не договорная', () => {
    const r = buildProductReport([order(1, [item({ manualTotal: 6100 }), item({ manualTotal: '' })], { discount_percent: 50 })])
    // 6100 с НДС → 5000 без НДС; 12200 × 0,5 = 6100 → 5000
    expect(r.total.revenueExVat).toBe(10000)
  })

  it('строки складываются в итог до рубля, выручка − себестоимость = маржа', () => {
    const r = buildProductReport([
      order(1, [item({ saleIncVat: 10001, costExVat: 3333.33 }), item({ category: 'зеркало', materialName: 'Зеркало Серебро 4 мм', saleIncVat: 7777, costExVat: 2222.6 })]),
      order(2, [item({ saleIncVat: 5555, costExVat: 1111.5, hasTempering: false })]),
    ])
    const sum = (k: 'revenueExVat' | 'costExVat' | 'marginRub') => r.categories.reduce((s, c) => s + c[k], 0)
    expect(sum('revenueExVat')).toBe(r.total.revenueExVat)
    expect(sum('costExVat')).toBe(r.total.costExVat)
    expect(sum('marginRub')).toBe(r.total.marginRub)
    for (const c of r.categories) {
      expect(c.revenueExVat - c.costExVat).toBe(c.marginRub)
      expect(c.materials.reduce((s, m) => s + m.revenueExVat, 0)).toBe(c.revenueExVat)
    }
  })

  it('закалённое и сырое стекло одного названия — разные строки', () => {
    const r = buildProductReport([order(1, [item({}), item({ hasTempering: false })])])
    expect(r.categories[0].materials.map(m => m.label).sort()).toEqual(['Стекло Осветлённое 8 мм', 'Стекло Осветлённое 8 мм · закалка'])
  })

  it('позиция без себестоимости видна счётчиком и не поднимает процент маржи', () => {
    const r = buildProductReport([order(1, [item({}), item({ costExVat: 0 })])])
    expect(r.total.noCostItems).toBe(1)
    expect(r.total.marginPct).toBe(40)  // только первая позиция: 1 − 6000/10000
  })

  it('учитываются только запущенные заказы с позициями выбранного месяца', () => {
    const orders = [
      order(1, [item({})]),
      order(2, [item({})], { launched_at: '2026-08-31' }),
      order(3, []),
      order(4, [item({})], { launched_at: '' }),
    ]
    expect(buildProductReport(orders, { month: '2026-09' }).orders).toBe(1)
    expect(buildProductReport(orders).orders).toBe(2)
    expect(launchMonths(orders)).toEqual(['2026-09', '2026-08'])
  })

  it('переделка считается по позиции заказа (order_id:item_index)', () => {
    const r = buildProductReport([order(7, [item({}), item({ category: 'зеркало' })])], { reworkKeys: new Set(['7:1']) })
    expect(r.categories.find(c => c.key === 'зеркало')!.reworkItems).toBe(1)
    expect(r.categories.find(c => c.key === 'стекло')!.reworkItems).toBe(0)
  })

  it('цвет порога — по показанному значению', () => {
    expect(marginTone(34.9)).toBe('amber')
    expect(marginTone(35)).toBe('green')
    expect(marginTone(24.9)).toBe('red')
    expect(marginTone(null)).toBe('none')
  })
})
