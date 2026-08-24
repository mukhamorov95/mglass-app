import { describe, it, expect } from 'vitest'
import {
  computeQuantities, computePrice, unitPricesFor, pickStock, barsCost, DEFAULT_FINANCE,
  migrateUnitPrices, buildDefaultUnitPrices, supplierColorToFinish, selectableOptions,
  type UnitPrices, type PieceItem, type BarItem,
} from '@/lib/configurator/pricing'
import { buildFromModel } from '@/components/configurator/scene/assembly'
import { getModel } from '@/lib/configurator/arrangement'

// Модель: подгруппы ПУСТЫЕ, позиции добавляются (как из справочника). Кол-во piece —
// из РОЛИ подгруппы (геометрия). Хелпер имитирует «подтянули позиции из справочника».
function priced(tier: 'budget' | 'premium'): UnitPrices {
  const up = buildDefaultUnitPrices(tier)
  const hinges = up.groups.find(g => g.id === 'hinges')!
  ;(hinges.items as PieceItem[]).push({ key: 'h1', name: 'Петля X', qtyMode: 'auto', prices: { chrome: 2000, gold: 3000 } })
  const handles = up.groups.find(g => g.id === 'handles')!
  ;(handles.items as PieceItem[]).push({ key: 'ha1', name: 'Ручка X', qtyMode: 'auto', prices: { chrome: 1500 } })
  const profiles = up.groups.find(g => g.id === 'profiles')!
  ;(profiles.items as BarItem[]).push({ key: 'profile', name: 'Профиль', stocks: [{ len: 2200, prices: { chrome: 1000 } }, { len: 3000, prices: { chrome: 1200 } }] })
  const tubes = up.groups.find(g => g.id === 'tubes')!
  ;(tubes.items as BarItem[]).push({ key: 'tube', name: 'Штанга', stocks: [{ len: 2200, prices: { chrome: 2500 } }, { len: 3000, prices: { chrome: 4000 } }] })
  return up
}

describe('pricing — роли, хлысты, цвет, справочник', () => {
  it('количества: секции, м², куски профиля/штанги, роли из модели', () => {
    const a = buildFromModel(getModel('М7'), { width: 1100, height: 2000, width2: 900, doorWidth: 600 }, 8)
    const q = computeQuantities(a, 8)
    expect(q.sections).toBe(a.glass.length)
    expect(q.glassM2).toBeGreaterThan(0)
    expect(q.profilePieces.length).toBeGreaterThan(0)
    expect(q.roles.hinge).toBeGreaterThanOrEqual(2)     // распашная — петли есть
    expect(q.roles.handle).toBe(1)
    expect(q.roles.cap).toBe(q.profilePieces.length * 2) // заглушки = 2×кусков
  })

  it('хлыст: кусок ≤2200 → 2200, >2200 → 3000, длиннее 3000 → 3000', () => {
    const stocks = [{ len: 2200, price: 500 }, { len: 3000, price: 700 }]
    expect(pickStock(2000, stocks).len).toBe(2200)
    expect(pickStock(2200, stocks).len).toBe(2200)
    expect(pickStock(2500, stocks).len).toBe(3000)
    expect(pickStock(3200, stocks).len).toBe(3000)
    const { cost, bars } = barsCost([2000, 2500, 2100], stocks)
    expect(cost).toBe(500 + 700 + 500)
    expect(bars).toEqual({ 2200: 2, 3000: 1 })
  })

  it('цена: Себест/(1−маржа−налог) + монтаж×секции + доставка; кол-во петель = роль модели', () => {
    const a = buildFromModel(getModel('М7'), { width: 1100, height: 2000, width2: 900, doorWidth: 600 }, 8)
    const q = computeQuantities(a, 8)
    const up = priced('budget')
    const p = computePrice(q, up, DEFAULT_FINANCE, { glassType: 'clear', finishId: 'chrome' })
    expect(p.materialsCost).toBe(p.glassCost + p.hardwareCost + p.profileCost + p.tubeCost)
    expect(p.itemPrice).toBe(Math.round(p.materialsCost / 0.48))
    expect(p.installCost).toBe(up.installPerSection * q.sections)
    expect(p.deliveryCost).toBe(5000)
    expect(p.total).toBe(p.itemPrice + p.installCost + p.deliveryCost)
    expect(p.profileCost).toBeGreaterThan(0)
    // строка петель: кол-во = роль hinge, цена 2000 (chrome)
    const hingeLine = p.groupedLines.find(g => g.id === 'hinges')!.lines[0]
    expect(hingeLine.qty).toBe(q.roles.hinge)
    expect(hingeLine.total).toBe(q.roles.hinge * 2000)
  })

  it('пустые подгруппы (без позиций) → себестоимость = только стекло, комплект НЕ полный', () => {
    const a = buildFromModel(getModel('М7'), { width: 1100, height: 2000, width2: 900, doorWidth: 600 }, 8)
    const q = computeQuantities(a, 8)
    const p = computePrice(q, buildDefaultUnitPrices('budget'), DEFAULT_FINANCE, {})
    expect(p.hardwareCost).toBe(0)
    expect(p.profileCost).toBe(0)
    expect(p.materialsCost).toBe(p.glassCost)
    expect(p.complete).toBe(false)
    expect(p.missing.some(m => m.id === 'hinges')).toBe(true)   // распашной нужны петли
    expect(p.missing.some(m => m.id === 'profiles')).toBe(true) // и профиль
  })

  it('полнота: заполненная требуемая подгруппа не в missing; нулевая цена → в missing', () => {
    const a = buildFromModel(getModel('М7'), { width: 1100, height: 2000, width2: 900, doorWidth: 600 }, 8)
    const q = computeQuantities(a, 8)
    const p = computePrice(q, priced('budget'), DEFAULT_FINANCE, { finishId: 'chrome' })
    expect(p.missing.some(m => m.id === 'hinges')).toBe(false)
    expect(p.missing.some(m => m.id === 'profiles')).toBe(false)
    // обнулим цену петли (нет цены ни для одного цвета) → hinges снова в missing
    const up2 = priced('budget')
    ;(up2.groups.find(g => g.id === 'hinges')!.items as PieceItem[])[0].prices = {}
    const p2 = computePrice(q, up2, DEFAULT_FINANCE, { finishId: 'chrome' })
    expect(p2.missing.some(m => m.id === 'hinges')).toBe(true)
  })

  it('две auto-позиции в подгруппе: кол-во получает только первая (вторая — запасная, 0)', () => {
    const a = buildFromModel(getModel('М7'), { width: 1100, height: 2000, width2: 900, doorWidth: 600 }, 8)
    const q = computeQuantities(a, 8)
    const up = priced('budget')
    const hinges = up.groups.find(g => g.id === 'hinges')!
    ;(hinges.items as PieceItem[]).push({ key: 'h2', name: 'Петля Y', qtyMode: 'auto', prices: { chrome: 9999 } })
    const p = computePrice(q, up, DEFAULT_FINANCE, { finishId: 'chrome' })
    const hingeLines = p.groupedLines.find(g => g.id === 'hinges')!.lines
    expect(hingeLines.length).toBe(1)               // вторая (0) не попала в строки
    expect(hingeLines[0].total).toBe(q.roles.hinge * 2000)
  })

  it('цвет фурнитуры меняет себестоимость (золото дороже хрома)', () => {
    const a = buildFromModel(getModel('М7'), { width: 1100, height: 2000, width2: 900, doorWidth: 600 }, 8)
    const q = computeQuantities(a, 8)
    const up = priced('budget')
    const chrome = computePrice(q, up, DEFAULT_FINANCE, { finishId: 'chrome' })
    const gold = computePrice(q, up, DEFAULT_FINANCE, { finishId: 'gold' })
    expect(gold.hardwareCost).toBeGreaterThan(chrome.hardwareCost)   // петля gold 3000 > chrome 2000
  })

  it('премиум дороже бюджета по стеклу; бронза дороже прозрачного', () => {
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
    const p = computePrice(q, priced('budget'), DEFAULT_FINANCE, { withDelivery: false })
    expect(p.deliveryCost).toBe(0)
  })

  it('авто-количества: заглушки = 2×кусков профиля, уплотнитель = число распашных створок', () => {
    const a = buildFromModel(getModel('М7'), { width: 1100, height: 2000, width2: 900, doorWidth: 600 }, 8)
    const q = computeQuantities(a, 8)
    expect(q.roles.cap).toBe(q.profilePieces.length * 2)
    expect(q.roles.seal).toBe(q.roles.handle)   // 1 магнитный уплотнитель на распашную створку
  })

  it('хлысты: произвольная длина (штанга ≠ профиль), цена по длине', () => {
    const a = buildFromModel(getModel('М10'), { width: 1400, height: 2000 }, 8)
    const q = computeQuantities(a, 8)
    const up = priced('budget')
    const tubes = up.groups.find(g => g.id === 'tubes')!
    ;(tubes.items[0] as BarItem).stocks = [{ len: 2500, prices: { chrome: 3000 } }, { len: 3200, prices: { chrome: 4200 } }]
    const p = computePrice(q, up, DEFAULT_FINANCE, { finishId: 'chrome' })
    expect(q.tubePieces.length).toBeGreaterThan(0)
    expect(p.tubeCost).toBeGreaterThan(0)
    expect(Object.keys(p.tubeBars).every(len => len === '2500' || len === '3200')).toBe(true)
  })

  it('маппинг цветов поставщика → цвет визуализатора (Ветро и АВ24)', () => {
    expect(supplierColorToFinish('Cp (хром полированный)')).toBe('chrome')
    expect(supplierColorToFinish('Satin Nickel (матовый хром)')).toBe('satin')
    expect(supplierColorToFinish('Black (чёрный матовый)')).toBe('black')
    expect(supplierColorToFinish('Gun Metal (матовый)')).toBe('gunmetal')
    expect(supplierColorToFinish('Bronze (античная бронза)')).toBe('bronze')
    expect(supplierColorToFinish('Gold (золото глянцевое)')).toBe('gold')
    expect(supplierColorToFinish('BrGold (брашированное золото)')).toBe('brgold')
    expect(supplierColorToFinish('White (белый матовый)')).toBe('white')
    expect(supplierColorToFinish('Polish Rose gold (полированное розовое золото)')).toBe('rose')
    expect(supplierColorToFinish('BrRose gold (брашированное розовое золото)')).toBe('brrose')
    expect(supplierColorToFinish('полированный')).toBe('chrome')
    expect(supplierColorToFinish('матовый')).toBe('satin')
    expect(supplierColorToFinish('черный')).toBe('black')
    expect(supplierColorToFinish('оружейная сталь')).toBe('gunmetal')
    expect(supplierColorToFinish('брашированное золото')).toBe('brgold')
    expect(supplierColorToFinish('')).toBeNull()
  })

  it('миграция: старая плоская схема → пустые подгруппы, стекло/монтаж сохранены', () => {
    const legacy = {
      glassPerM2: { clear: 9999 },
      hardware: { balge: { chrome: 7777 } },
      profileStock: [{ len: 2200, price: 1000 }],
      installPerSection: 6500, deliveryMoscow: 5000, liftPerFloor: 0,
    }
    const up = migrateUnitPrices(legacy, 'budget')
    expect(up.glassPerM2.clear).toBe(9999)                         // стекло владельца сохранено
    expect(up.groups.find(g => g.id === 'hinges')!.items.length).toBe(0)   // фейковые сиды исчезли
    expect(up.groups.find(g => g.id === 'hinges')!.role).toBe('hinge')     // роль на месте
  })

  it('выбор клиента (choice) определяет, какая петля идёт в цену', () => {
    const a = buildFromModel(getModel('М7'), { width: 1100, height: 2000, width2: 900, doorWidth: 600 }, 8)
    const q = computeQuantities(a, 8)
    const up = priced('budget')
    const hinges = up.groups.find(g => g.id === 'hinges')!
    ;(hinges.items as PieceItem[]).push({ key: 'h2', name: 'Петля Y', qtyMode: 'auto', prices: { chrome: 5000 } })
    const pDefault = computePrice(q, up, DEFAULT_FINANCE, { finishId: 'chrome' })
    const pChosen = computePrice(q, up, DEFAULT_FINANCE, { finishId: 'chrome', choice: { hinge: 'h2' } })
    expect(pDefault.groupedLines.find(g => g.id === 'hinges')!.lines[0].total).toBe(q.roles.hinge * 2000)  // первая
    expect(pChosen.groupedLines.find(g => g.id === 'hinges')!.lines[0].total).toBe(q.roles.hinge * 5000)   // выбранная h2
  })

  it('selectableOptions: петли/ручки с формой (shape), без себестоимости', () => {
    const up = priced('budget')
    ;(up.groups.find(g => g.id === 'handles')!.items as PieceItem[]).push({ key: 'kn', name: 'Ручка-кноб KN-1', qtyMode: 'auto', prices: { chrome: 900 } })
    const opts = selectableOptions(up)
    expect(opts.hinge?.length).toBe(1)
    expect(opts.handle?.length).toBe(2)
    expect(opts.handle?.find(o => o.key === 'kn')?.shape).toBe('handle-knob')   // «кноб» → форма
    // себестоимость не утекает
    expect(JSON.stringify(opts)).not.toMatch(/price|prices|cost/)
  })

  it('миграция: новая схема с подгруппами возвращается как есть', () => {
    const fresh = priced('premium')
    const up = migrateUnitPrices(fresh, 'premium')
    expect(up.groups).toEqual(fresh.groups)
  })
})
