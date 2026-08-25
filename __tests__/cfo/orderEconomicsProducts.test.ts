import { describe, it, expect } from 'vitest'
import { computeOrderEconomics, type EcoItem, type EcoOrder } from '@/lib/orderEconomics'
import { computeMaterialUsage, isSheetMaterial } from '@/lib/materialUsage'
import { DEFAULT_SHOP_SALARIES, type ShopThroughput } from '@/lib/laborModel'

// Регресс заказа #5322: «Зеркало с подсветкой в металлической раме» (category='изделие',
// 500×1700, себестоимость 20 271 ₽) уезжало в раскрой, получало виртуальный лист
// 3210×2250 и списывало невозвратный остаток по 23 848 ₽/м² — честная себестоимость
// вырастала до 66 301 ₽, а «честная маржа» показывала −76% на прибыльном заказе.

const PRODUCT: EcoItem = {
  materialName: 'Зеркало с подсветкой в металлической раме Осветлённое 4 мм',
  thickness: 4, category: 'изделие',
  width: 500, height: 1700, quantity: 1, wastePercent: 0,
  costPerM2: 20271 / 0.85,
  hasTempering: false, hasHoles: false, perimeterM: 4.4,
  servicesCostPrice: 0, servicesSale: 0,
}

const THROUGHPUT: ShopThroughput = { netM2: 500, edgeM: 900, drilledPcs: 40, packedPcs: 0 }

describe('изделие производства не раскраивается', () => {
  it('isSheetMaterial отделяет изделия от листовых материалов', () => {
    expect(isSheetMaterial('изделие')).toBe(false)
    expect(isSheetMaterial('стекло')).toBe(true)
    expect(isSheetMaterial('зеркало')).toBe(true)
    expect(isSheetMaterial(undefined)).toBe(true)
  })

  it('раскрой не выдаёт изделию виртуальный лист', () => {
    const usage = computeMaterialUsage([{
      materialName: PRODUCT.materialName, thickness: 4, category: 'изделие',
      width: 500, height: 1700, quantity: 1, costPerM2: PRODUCT.costPerM2,
    }])
    expect(usage).toEqual([])
  })

  it('честная себестоимость изделия равна покупной, маржа не уходит в минус', () => {
    const order: EcoOrder = { id: 5322, clientName: 'Артур', revenue: 38008, items: [PRODUCT] }
    const e = computeOrderEconomics(order, DEFAULT_SHOP_SALARIES, THROUGHPUT)
    expect(e.sheets).toBe(0)
    // Материал честно ≈ материал по системе (расхождение только на округлении)
    expect(Math.abs(e.honestMaterial - e.systemMaterial)).toBeLessThan(2)
    expect(e.honestMargin).toBeGreaterThan(0)
    // Разрыв «система приукрашивает» теперь объясняется только недостающим трудом
    expect(e.marginGap).toBeLessThan(10)
  })

  it('листовое стекло по-прежнему считается раскроем', () => {
    const glass: EcoItem = { ...PRODUCT, materialName: 'Осветлённое 4 мм', category: 'стекло', costPerM2: 1200 }
    const order: EcoOrder = { id: 1, clientName: 'x', revenue: 10000, items: [glass] }
    const e = computeOrderEconomics(order, DEFAULT_SHOP_SALARIES, THROUGHPUT)
    expect(e.sheets).toBeGreaterThan(0)
    expect(e.honestMaterial).toBeGreaterThan(e.systemMaterial)
  })
})
