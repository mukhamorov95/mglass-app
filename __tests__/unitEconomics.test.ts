import { describe, it, expect } from 'vitest'
import { orderContribution, sumContributions, contributionColor } from '@/lib/unitEconomics'

// Заказ #5466 из базы, позиции как есть. Раньше по нему было три разные «маржи»:
// +25,9% (калькулятор), −9,6% (список просчётов), −44,7% (карточка экономики).
const ORDER_5466 = [
  { materialName: 'Осветлённое CrystalVision', category: 'стекло', thickness: 4, width: 470, height: 2265, quantity: 2,
    totalAreaNet: 2.1292, totalAreaBilled: 2.3762, hasTempering: true, hasHoles: false,
    costMaterial: 2258, costTempering: 639, costTransport: 154, costPackaging: 256, costEdge: 438, costFacet: 0, costTriplex: null },
  { materialName: 'Осветлённое CrystalVision', category: 'стекло', thickness: 4, width: 470, height: 2220, quantity: 1,
    totalAreaNet: 1.0434, totalAreaBilled: 1.1644, hasTempering: true, hasHoles: false,
    costMaterial: 1107, costTempering: 313, costTransport: 77, costPackaging: 125, costEdge: 215, costFacet: 0, costTriplex: null },
  { materialName: 'Осветлённое CrystalVision', category: 'стекло', thickness: 4, width: 470, height: 2220, quantity: 1,
    totalAreaNet: 1.0434, totalAreaBilled: 1.1644, hasTempering: true, hasHoles: true,
    costMaterial: 1107, costTempering: 313, costTransport: 77, costPackaging: 125, costEdge: 215, costFacet: 0, costTriplex: null },
  { materialName: 'CrystalVision Matelux', category: 'стекло', thickness: 4, width: 590, height: 2013, quantity: 1,
    totalAreaNet: 1.1877, totalAreaBilled: 2.1165, hasTempering: true, hasHoles: true,
    costMaterial: 2222, costTempering: 356, costTransport: 77, costPackaging: 143, costEdge: 208, costFacet: 0, costTriplex: null },
]

describe('вклад заказа — единственное определение', () => {
  const c = orderContribution(14075, ORDER_5466)

  it('переменные — материал, закалка, доставка, упаковка; без кромки', () => {
    const by = Object.fromEntries(c.lines.map(l => [l.key, l.amount]))
    expect(by).toEqual({ material: 6694, tempering: 1621, transport: 385, packaging: 649 })
    expect(c.variable).toBe(9349)
  })

  it('кромка не входит — это работа цеха на окладе', () => {
    expect(c.excluded).toEqual([expect.objectContaining({ key: 'edge', amount: 1076 })])
    expect(c.lines.some(l => (l.key as string) === 'edge')).toBe(false)
  })

  it('НДС: исходящий минус входящий по стеклу и закалке', () => {
    expect(c.vatOut).toBe(2538)
    expect(c.vatIn).toBe(1499)          // (6694 + 1621) × 22/122
    expect(c.vatToPay).toBe(1039)
    const byKey = Object.fromEntries(c.lines.map(l => [l.key, l.vatIn]))
    expect(byKey.transport).toBe(0)
    expect(byKey.packaging).toBe(0)
  })

  it('вклад сходится двумя путями', () => {
    expect(c.contribution).toBe(3687)
    expect(c.contribution).toBe(c.revenue - c.variable - c.vatToPay)   // сходится на экране до рубля
    expect(c.contribution).toBe(c.revenueExVat - (c.variable - c.vatIn))
    expect(c.revenueExVat).toBe(11537)
    expect(c.contributionPct).toBe(32)
  })

  it('как посчитано — пишется рядом с суммой', () => {
    const how = Object.fromEntries(c.lines.map(l => [l.key, l.how]))
    expect(how.tempering).toBe('300 ₽/м² × 5,40 м² (4 мм)')
    expect(how.transport).toBe('77 ₽ × 5 дет.')
    expect(how.material).toContain('6,82 м²')
  })

  it('оклады и загрузка месяца на вклад не влияют', () => {
    // В определении нет ни ставок, ни окна периода — только позиции и выручка.
    expect(orderContribution(14075, ORDER_5466)).toEqual(c)
  })
})

describe('изделие производства', () => {
  // Регресс #5322: изделие уезжало в раскрой и получало виртуальный лист.
  // Здесь раскроя нет вовсе — себестоимость берётся как сохранена в позиции.
  it('себестоимость изделия не пересчитывается', () => {
    const c = orderContribution(35000, [{ category: 'изделие', width: 500, height: 1700, quantity: 1,
      totalAreaNet: 0.85, totalAreaBilled: 0.85, costMaterial: 20271, hasTempering: false }])
    expect(c.lines.find(l => l.key === 'material')?.amount).toBe(20271)
  })
})

describe('сводка и цвет', () => {
  it('сумма вкладов и процент от выручки без НДС', () => {
    const a = orderContribution(14075, ORDER_5466)
    const s = sumContributions([a, a])
    expect(s.contribution).toBe(7374)
    expect(s.contributionPct).toBe(32)
  })
  it('пороги цвета', () => {
    expect(contributionColor(24.9)).toBe('red')
    expect(contributionColor(32)).toBe('amber')
    expect(contributionColor(35)).toBe('green')
  })
})
