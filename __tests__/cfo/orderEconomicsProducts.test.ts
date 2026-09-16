import { describe, it, expect } from 'vitest'
import { computeMaterialUsage, isSheetMaterial } from '@/lib/materialUsage'
import { orderContribution } from '@/lib/unitEconomics'

// Регресс заказа #5322: «Зеркало с подсветкой в металлической раме» (category='изделие',
// 500×1700, себестоимость 20 271 ₽) уезжало в раскрой, получало виртуальный лист
// 3210×2250 и списывало невозвратный остаток по 23 848 ₽/м² — честная себестоимость
// вырастала до 66 301 ₽, а «честная маржа» показывала −76% на прибыльном заказе.

const PRODUCT = {
  materialName: 'Зеркало с подсветкой в металлической раме Осветлённое 4 мм',
  thickness: 4, category: 'изделие',
  width: 500, height: 1700, quantity: 1,
  totalAreaNet: 0.85, totalAreaBilled: 0.85, costMaterial: 20271, costPerM2: 20271 / 0.85,
  hasTempering: false, hasHoles: false, perimeterM: 4.4,
}

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

  it('вклад изделия считается от сохранённой себестоимости и не уходит в минус', () => {
    const c = orderContribution(38008, [PRODUCT])
    // С 16.09 изделие — своя статья «Изделия производства», не «Материал»
    expect(c.lines.find(l => l.key === 'product')?.amount).toBe(20271)
    expect(c.contribution).toBeGreaterThan(0)
  })
})
