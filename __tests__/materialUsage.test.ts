import { describe, it, expect } from 'vitest'
import { computeMaterialUsage, sumUsage, autoWasteByMaterial, type UsageItem } from '@/lib/materialUsage'
import { laborRates, pieceLaborCost, DEFAULT_SHOP_SALARIES } from '@/lib/laborModel'
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

  it('reuseRate=1 → расход ≈ нетто + потеря реза (крупный остаток возвращён)', () => {
    const [u] = computeMaterialUsage(satin60, 1)
    // при полном реюзе честная стоимость = нетто + мелкая потеря реза
    expect(u.honestCost).toBeGreaterThanOrEqual(u.netCost)
    expect(u.honestCost - u.netCost).toBeLessThan(u.fullSheetsCost - u.netCost)
  })

  it('reuseRate=0 → расход = целые листы (ничего не возвращается)', () => {
    const [u] = computeMaterialUsage(satin60, 0)
    expect(u.honestCost).toBe(u.fullSheetsCost)
  })

  it('больше реюза — меньше расход (монотонность)', () => {
    const lo = computeMaterialUsage(satin60, 0.3)[0].honestCost
    const hi = computeMaterialUsage(satin60, 0.9)[0].honestCost
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

describe('laborModel — ставка от объёма (operating leverage)', () => {
  it('вдвое больший объём — вдвое меньше ставка резки', () => {
    const r1 = laborRates(DEFAULT_SHOP_SALARIES, { netM2: 777, edgeM: 3284, drilledPcs: 49, packedPcs: 715 })
    const r2 = laborRates(DEFAULT_SHOP_SALARIES, { netM2: 1554, edgeM: 6568, drilledPcs: 98, packedPcs: 1430 })
    expect(r2.cuttingPerM2).toBeCloseTo(r1.cuttingPerM2 / 2, 1)
    expect(r2.edgePerM).toBeCloseTo(r1.edgePerM / 2, 1)
  })

  it('июльские ставки совпадают с ручным расчётом зарплата÷объём', () => {
    const r = laborRates(DEFAULT_SHOP_SALARIES, { netM2: 777.3, edgeM: 3284, drilledPcs: 49, packedPcs: 715 })
    expect(Math.round(r.cuttingPerM2)).toBe(Math.round(160_000 / 777.3))   // ≈206
    expect(Math.round(r.edgePerM)).toBe(Math.round(120_000 / 3284))         // ≈37
    expect(Math.round(r.drillingPerPiece)).toBe(Math.round(150_000 / 49))   // ≈3061
  })

  it('нулевой объём операции → нулевая ставка, не деление на ноль', () => {
    const r = laborRates(DEFAULT_SHOP_SALARIES, { netM2: 0, edgeM: 0, drilledPcs: 0, packedPcs: 0 })
    expect(r.cuttingPerM2).toBe(0)
    expect(r.drillingPerPiece).toBe(0)
    expect(Number.isFinite(r.edgePerM)).toBe(true)
  })

  it('деталь без отверстий не тянет стоимость сверловки', () => {
    const r = laborRates(DEFAULT_SHOP_SALARIES, { netM2: 777, edgeM: 3284, drilledPcs: 49, packedPcs: 715 })
    const noDrill = pieceLaborCost(r, { netM2: 2, edgeM: 6, drilledPcs: 0, pcs: 1 })
    expect(noDrill.drilling).toBe(0)
    expect(noDrill.total).toBe(noDrill.cutting + noDrill.edge + noDrill.packaging)
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
