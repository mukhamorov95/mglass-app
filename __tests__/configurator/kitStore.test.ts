import { describe, it, expect, vi, beforeEach } from 'vitest'

// Регрессия 01.10: getKit читал из configurator_model_kits только slots — маржа модели и
// «не используется» терялись по дороге в цену (сайт, «Расчёт», CFO). Проверяем на читателе.
let row: { kit: unknown } | null = null
vi.mock('server-only', () => ({}))
vi.mock('@/lib/configurator/pricingStore', () => ({ getPricing: vi.fn() }))
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => {
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: row, error: null }) }
    return { from: () => q }
  },
}))

import { getKit } from '@/lib/configurator/kitStore'
import { computeKitQuantities, computeKitPrice, normalizeKit, ROLES, type Library, type KitRates } from '@/lib/configurator/kit'
import { calcFinancialModel } from '@/lib/pricing/financialModel'
import { buildFromModel } from '@/components/configurator/scene/assembly'
import { getModel } from '@/lib/configurator/arrangement'

const RATES: KitRates = {
  glassPerM2: { clear: 3200, crystal: 3900, bronze: 4600, graphite: 4600 },
  installPerSection: 6500, deliveryMoscow: 5000, liftPerFloor: 0,
}
const FIN = { marginPct: 40, taxPct: 12 }
const LIB: Library = { items: [] }
const m8 = () => {
  const model = getModel('М8')
  return computeKitQuantities(buildFromModel(model, { width: 1200, height: 2000, width2: 1200 }, 8), 8, model)
}

beforeEach(() => { row = null })

describe('getKit — отдаёт всё, что сохранила админка', () => {
  it('excluded: [roller] доходит до цены — ролик не «нет позиции»', async () => {
    const q = m8()
    expect(q.roleQty.roller).toBeGreaterThan(0)                     // геометрия М8 ролики требует

    row = { kit: { slots: [] } }
    const before = computeKitPrice(q, LIB, (await getKit('premium', 'М8', LIB)).kit, RATES, FIN)
    expect(before.missing.some(m => m.role === 'roller')).toBe(true)

    row = { kit: { slots: [], excluded: ['roller'] } }
    const { kit, seeded } = await getKit('premium', 'М8', LIB)
    expect(seeded).toBe(false)
    expect(kit.excluded).toEqual(['roller'])
    const after = computeKitPrice(q, LIB, kit, RATES, FIN)
    expect(after.missing.some(m => m.role === 'roller')).toBe(false)
  })

  it('margin: 45 — цена изделия по 45%, а не по марже тарифа', async () => {
    row = { kit: { slots: [], margin: 45 } }
    const { kit } = await getKit('budget', 'М8', LIB)
    expect(kit.margin).toBe(45)
    const p = computeKitPrice(m8(), LIB, kit, RATES, FIN)
    expect(p.marginPct).toBe(45)
    expect(p.marginSource).toBe('модель')
    expect(p.itemPrice).toBe(calcFinancialModel({ directCost: p.materialsCost, marginPercent: 45, taxPercent: 12 })!.finalPrice)
    // Цель, а не формула: после себестоимости и налога в цене остаются те самые 45%.
    expect((p.itemPrice - p.materialsCost - p.itemPrice * 0.12) / p.itemPrice).toBeCloseTo(0.45, 3)
    expect(p.itemPrice).toBeGreaterThan(calcFinancialModel({ directCost: p.materialsCost, marginPercent: 40, taxPercent: 12 })!.finalPrice)
  })

  it('мусор в margin/excluded отбрасывается, слоты остаются', async () => {
    for (const margin of [0, -5, 100, 150, '45', null, Number.NaN]) {
      row = { kit: { slots: [], margin } }
      expect((await getKit('budget', 'М8', LIB)).kit).toEqual({ slots: [] })
    }
    row = { kit: { slots: [], excluded: ['roller', 'нет-такой', 7, 'roller', 'cap-end'] } }
    expect((await getKit('budget', 'М8', LIB)).kit.excluded).toEqual(['roller', 'cap-end'])
    row = { kit: { slots: [], excluded: 'roller' } }
    expect((await getKit('budget', 'М8', LIB)).kit).toEqual({ slots: [] })
  })

  it('строки нет или slots не массив — комплект по умолчанию, как раньше', async () => {
    expect((await getKit('budget', 'М8', LIB)).seeded).toBe(true)
    row = { kit: { margin: 45 } }
    expect((await getKit('budget', 'М8', LIB)).seeded).toBe(true)
    expect(normalizeKit(null)).toBeNull()
  })
})

describe('computeKitPrice — невозможная маржа не превращается в цену', () => {
  it('маржа модели + налог ≥ 100% → complete:false, а не цена = монтаж + доставка', () => {
    const kit = { slots: [], excluded: [...ROLES] }                  // пропусков нет — решает только маржа
    expect(computeKitPrice(m8(), LIB, { ...kit, margin: 45 }, RATES, FIN).complete).toBe(true)
    const p = computeKitPrice(m8(), LIB, { ...kit, margin: 90 }, RATES, FIN)
    expect(p.missing).toEqual([])
    expect(p.itemPrice).toBe(0)
    expect(p.complete).toBe(false)
  })
})
