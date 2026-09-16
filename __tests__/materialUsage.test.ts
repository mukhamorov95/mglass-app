import { describe, it, expect } from 'vitest'
import { computeMaterialUsage, sumUsage, autoWasteByMaterial, type UsageItem } from '@/lib/materialUsage'
import { applyAutoWaste, calcItem, type B2BOrderItem } from '@/lib/b2bCalculator'
import { applyAutoWasteToItems } from '@/lib/autoWasteApply'
import type { B2BMaterial } from '@/lib/types'

// Автоматический расход не должен ни завышать (целые листы в лом), ни занижать
// (голое нетто). Проверяем границы и монотонность по reuseRate.
describe('computeMaterialUsage — честный расход материала', () => {
  // 60 прямоугольников 291×913 сатина 4мм — реальный кейс из разбора с владельцем
  const satin60: UsageItem[] = [{
    materialName: 'Сатинированное бесцветное', thickness: 4, category: 'сатин',
    width: 291, height: 913, quantity: 60, costPerM2: 740,
  }]

  it('нетто ≤ честный расход ≤ целые листы (границы физики)', () => {
    const [u] = computeMaterialUsage(satin60, 0.7)
    expect(u.netCost).toBeLessThanOrEqual(u.honestCost)
    expect(u.honestCost).toBeLessThanOrEqual(u.fullSheetsCost)
  })

  // Одна деталь из целого листа: остаток 6+ м² — приход на стеллаж, а не отход заказа
  // (замечание владельца по заказу #5479, 16.09.2026).
  const onePiece: UsageItem[] = [{
    materialName: 'Осветлённое CrystalVision', thickness: 8, category: 'стекло',
    width: 800, height: 1000, quantity: 1, costPerM2: 2090,
  }]

  it('одна деталь из листа: заказ платит нетто + рез, остаток идёт на стеллаж', () => {
    const [u] = computeMaterialUsage(onePiece)
    expect(u.remnantM2).toBeGreaterThan(5)
    expect(u.honestCost).toBeGreaterThanOrEqual(u.netCost)
    // до 16.09 сюда прилетали ещё 15% остатка — почти целый лишний квадрат
    expect(u.honestCost).toBeLessThan(u.netCost * 1.1)
    expect(u.fullSheetsCost).toBeGreaterThan(u.netCost * 5)
  })

  it('reuseRate=1 → расход ≈ нетто + потеря реза (крупный остаток возвращён)', () => {
    const [u] = computeMaterialUsage(onePiece, 1)
    expect(u.honestCost).toBeGreaterThanOrEqual(u.netCost)
    expect(u.honestCost - u.netCost).toBeLessThan(u.fullSheetsCost - u.netCost)
  })

  it('плотный раскрой: обрезки мельче 400×800 — отход заказа, не остаток', () => {
    const [u] = computeMaterialUsage(satin60)
    expect(u.remnantM2).toBe(0)
    expect(u.honestCost).toBe(u.fullSheetsCost)
  })

  it('reuseRate=0 → расход = целые листы (ничего не возвращается)', () => {
    const [u] = computeMaterialUsage(satin60, 0)
    expect(u.honestCost).toBe(u.fullSheetsCost)
  })

  it('больше реюза — меньше расход (монотонность)', () => {
    const lo = computeMaterialUsage(onePiece, 0.3)[0].honestCost
    const hi = computeMaterialUsage(onePiece, 0.9)[0].honestCost
    expect(hi).toBeLessThan(lo)
  })

  it('60 деталей 291×913 умещаются примерно в 2 листа (сверка с владельцем)', () => {
    const [u] = computeMaterialUsage(satin60)
    expect(u.pieces).toBe(60)
    expect(u.sheets).toBeLessThanOrEqual(3)
    expect(u.sheets).toBeGreaterThanOrEqual(2)
  })

  it('пустой заказ — пустой расход, без падения', () => {
    expect(computeMaterialUsage([])).toEqual([])
    expect(sumUsage([]).honestCost).toBe(0)
  })
})

// ── Cutover авторасхода в калькулятор (#167) ─────────────────────────────────
const MAT: B2BMaterial = {
  id: 1, name: 'Прозрачное М1', category: 'стекло', thickness: 8,
  cost_price: 781, sale_price: 2000, waste_percent: 30,
  sheet_width: 3210, sheet_height: 2250,
} as B2BMaterial

function makeItem(w: number, h: number, q: number, wastePct: number): B2BOrderItem {
  return { ...calcItem(MAT, w, h, q, wastePct), localId: `${w}x${h}` }
}

describe('applyAutoWaste — пересчёт позиции под новый расход', () => {
  it('меняет ТОЛЬКО себестоимость/маржу, не трогает цену клиента', () => {
    const base = makeItem(500, 500, 4, 30)
    const re = applyAutoWaste(base, 10)
    expect(re.saleIncVat).toBe(base.saleIncVat)     // цена клиента не меняется
    expect(re.pricePerM2).toBe(base.pricePerM2)
    expect(re.totalAreaNet).toBe(base.totalAreaNet)
    expect(re.wastePercent).toBe(10)
    expect(re.costMaterial).toBeLessThan(base.costMaterial)  // меньше расход → меньше себест.
  })

  it('меньше расход → выше маржа, больше расход → ниже', () => {
    const base = makeItem(500, 500, 4, 30)
    expect(applyAutoWaste(base, 5).margin).toBeGreaterThan(base.margin)
    expect(applyAutoWaste(base, 60).margin).toBeLessThan(base.margin)
  })

  it('нулевой/битый вход не роняет', () => {
    const base = makeItem(500, 500, 4, 30)
    expect(applyAutoWaste(base, -5)).toBe(base)   // отрицательный расход игнорируется
    expect(applyAutoWaste({ ...base, totalAreaNet: 0 }, 20).costMaterial).toBe(base.costMaterial)
  })

  it('сохраняет договорную цену и услуги позиции', () => {
    const base = { ...makeItem(500, 500, 4, 30), manualTotal: 99_999 }
    const re = applyAutoWaste(base, 12)
    expect(re.manualTotal).toBe(99_999)
    expect(re.services).toEqual(base.services)
  })
})

describe('applyAutoWasteToItems — расход из раскроя по материалу', () => {
  it('один материал — один процент на все его позиции', () => {
    const items = [makeItem(500, 500, 10, 30), makeItem(600, 400, 8, 30)]
    const out = applyAutoWasteToItems(items, [MAT])
    expect(out[0].wastePercent).toBe(out[1].wastePercent)   // тот же материал → тот же %
    expect(out.length).toBe(2)
  })

  it('цена клиента у позиций не меняется', () => {
    const items = [makeItem(500, 500, 10, 30)]
    const out = applyAutoWasteToItems(items, [MAT])
    expect(out[0].saleIncVat).toBe(items[0].saleIncVat)
  })

  it('пустой заказ возвращается как есть', () => {
    expect(applyAutoWasteToItems([], [MAT])).toEqual([])
  })

  it('изделие производства НЕ трогается авто-расходом (своя полная себестоимость)', () => {
    const factory: B2BOrderItem = {
      ...makeItem(700, 2575, 1, 30),
      category: 'изделие', materialName: 'Зеркало с подсветкой Осветлённое 4 мм',
    }
    const out = applyAutoWasteToItems([factory], [MAT])
    expect(out[0].costExVat).toBe(factory.costExVat)   // себестоимость не раздувается
    expect(out[0].margin).toBe(factory.margin)
    expect(out[0].wastePercent).toBe(factory.wastePercent)
  })
})
