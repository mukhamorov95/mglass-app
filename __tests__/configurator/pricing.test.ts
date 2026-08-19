import { describe, it, expect } from 'vitest'
import { computeQuantities, computePrice, unitPricesFor, pickStock, barsCost, DEFAULT_FINANCE, migrateUnitPrices, buildDefaultUnitPrices } from '@/lib/configurator/pricing'
import { buildFromModel } from '@/components/configurator/scene/assembly'
import { getModel } from '@/lib/configurator/arrangement'

describe('pricing — cut-list + хлысты + цвет', () => {
  it('количества: секции = полотна, м²>0, куски профиля/штанги и фурнитура посчитаны', () => {
    const a = buildFromModel(getModel('М7'), { width: 1100, height: 2000, width2: 900, doorWidth: 600 }, 8)
    const q = computeQuantities(a, 8)
    expect(q.sections).toBe(a.glass.length)
    expect(q.glassM2).toBeGreaterThan(0)
    expect(q.profilePieces.length).toBeGreaterThan(0)   // куски Pr-002 (низ + стойки)
    expect(q.profilePieces.every(l => l > 0)).toBe(true)
    expect(q.hardware.balge).toBeGreaterThanOrEqual(2)
    expect(q.hardware.sd210).toBe(1)
  })

  it('хлыст: кусок ≤2200 → 2200, >2200 → 3000, длиннее 3000 → 3000', () => {
    const stocks = [{ len: 2200, price: 500 }, { len: 3000, price: 700 }]
    expect(pickStock(2000, stocks).len).toBe(2200)
    expect(pickStock(2200, stocks).len).toBe(2200)
    expect(pickStock(2500, stocks).len).toBe(3000)   // даже 2500 → покупаем 3000
    expect(pickStock(3200, stocks).len).toBe(3000)
    const { cost, bars } = barsCost([2000, 2500, 2100], stocks)
    expect(cost).toBe(500 + 700 + 500)               // 2200 + 3000 + 2200
    expect(bars).toEqual({ 2200: 2, 3000: 1 })
  })

  it('цена: Себест/(1−маржа−налог) + монтаж×секции + доставка; профиль/штанга по хлыстам', () => {
    const a = buildFromModel(getModel('М1'), { width: 1000, height: 2000 }, 8)
    const q = computeQuantities(a, 8)
    const up = unitPricesFor('budget')
    const p = computePrice(q, up, DEFAULT_FINANCE, { glassType: 'clear', finishId: 'chrome' })
    expect(p.materialsCost).toBe(p.glassCost + p.hardwareCost + p.profileCost + p.tubeCost)
    expect(p.itemPrice).toBe(Math.round(p.materialsCost / 0.48))
    expect(p.installCost).toBe(up.installPerSection * q.sections)
    expect(p.deliveryCost).toBe(5000)
    expect(p.total).toBe(p.itemPrice + p.installCost + p.deliveryCost)
    // профиль посчитан по хлыстам (сумма цен подобранных хлыстов)
    expect(p.profileCost).toBeGreaterThan(0)
  })

  it('цвет фурнитуры меняет себестоимость (золото дороже хрома)', () => {
    const a = buildFromModel(getModel('М7'), { width: 1100, height: 2000, width2: 900, doorWidth: 600 }, 8)
    const q = computeQuantities(a, 8)
    const chrome = computePrice(q, unitPricesFor('budget'), DEFAULT_FINANCE, { finishId: 'chrome' })
    const gold = computePrice(q, unitPricesFor('budget'), DEFAULT_FINANCE, { finishId: 'gold' })
    expect(gold.hardwareCost).toBeGreaterThan(chrome.hardwareCost)
  })

  it('премиум дороже бюджета; тип стекла (бронза) дороже прозрачного', () => {
    const a = buildFromModel(getModel('М1'), { width: 1000, height: 2000 }, 8)
    const q = computeQuantities(a, 8)
    const budget = computePrice(q, unitPricesFor('budget'), DEFAULT_FINANCE, { glassType: 'clear' })
    const premium = computePrice(q, unitPricesFor('premium'), DEFAULT_FINANCE, { glassType: 'clear' })
    expect(premium.total).toBeGreaterThan(budget.total)
    const bronze = computePrice(q, unitPricesFor('budget'), DEFAULT_FINANCE, { glassType: 'bronze' })
    expect(bronze.glassCost).toBeGreaterThan(budget.glassCost)
  })

  it('без доставки — доставка 0', () => {
    const a = buildFromModel(getModel('М10'), { width: 1400, height: 2000 }, 8)
    const q = computeQuantities(a, 8)
    const p = computePrice(q, unitPricesFor('budget'), DEFAULT_FINANCE, { withDelivery: false })
    expect(p.deliveryCost).toBe(0)
  })

  it('авто-количества: заглушки = 2×кусков профиля, уплотнитель = число распашных створок', () => {
    const a = buildFromModel(getModel('М7'), { width: 1100, height: 2000, width2: 900, doorWidth: 600 }, 8)
    const q = computeQuantities(a, 8)
    expect(q.hardware.cap).toBe(q.profilePieces.length * 2)
    expect(q.hardware.seal).toBe(q.hardware.sd210)   // 1 магнитный уплотнитель на распашную створку
  })

  it('подгруппы: цена группируется, себестоимость = стекло + все piece + профиль + штанга', () => {
    const a = buildFromModel(getModel('М7'), { width: 1100, height: 2000, width2: 900, doorWidth: 600 }, 8)
    const q = computeQuantities(a, 8)
    const p = computePrice(q, unitPricesFor('budget'), DEFAULT_FINANCE, {})
    expect(p.groupedLines.length).toBeGreaterThan(0)
    const grouped = p.groupedLines.reduce((s, g) => s + g.total, 0)
    expect(grouped).toBe(p.hardwareCost + p.profileCost + p.tubeCost)
    expect(p.materialsCost).toBe(p.glassCost + p.hardwareCost + p.profileCost + p.tubeCost)
  })

  it('миграция: старая плоская схема → подгруппы без потери введённых цен', () => {
    const legacy = {
      glassPerM2: { clear: 9999 },
      hardware: { balge: { chrome: 7777 } },
      profileStock: [{ len: 2200, price: 1000 }, { len: 3000, price: 1200 }],
      tubeStock: [{ len: 2200, price: 2500 }, { len: 3000, price: 4000 }],
      installPerSection: 6500, deliveryMoscow: 5000, liftPerFloor: 0,
    }
    const up = migrateUnitPrices(legacy, 'budget')
    expect(up.groups.length).toBeGreaterThan(0)
    expect(up.glassPerM2.clear).toBe(9999)
    const hinges = up.groups.find(g => g.id === 'hinges')!
    const balge = (hinges.items as { key: string; prices: Record<string, number> }[]).find(i => i.key === 'balge')!
    expect(balge.prices.chrome).toBe(7777)
    const profiles = up.groups.find(g => g.id === 'profiles')!
    const prof = (profiles.items as { key: string; bars: Record<string, Record<number, number>> }[])[0]
    expect(prof.bars.chrome[2200]).toBe(1000)   // хром = введённое значение, без наценки
    expect(prof.bars.chrome[3000]).toBe(1200)
  })

  it('миграция: новая схема с подгруппами возвращается как есть', () => {
    const fresh = buildDefaultUnitPrices('premium')
    const up = migrateUnitPrices(fresh, 'premium')
    expect(up.groups).toEqual(fresh.groups)
  })
})
