import { describe, it, expect } from 'vitest'
import { planOrderCutting, type OrderItemInput } from '@/lib/configurator/orderPlan'
import { computeKitQuantities, defaultKitFor, type Library } from '@/lib/configurator/kit'
import { buildFromModel } from '@/components/configurator/scene/assembly'
import { getModel } from '@/lib/configurator/arrangement'
import { FINISH_IDS } from '@/lib/configurator/pricing'

const allColors = (n: number) => Object.fromEntries(FINISH_IDS.map(f => [f, n]))
// Профиль двух длин, чтобы раскрой мог комбинировать; труба одной.
const LIB: Library = { items: [
  { id: 'mw', name: 'К стене', role: 'mount-wall', prices: allColors(352) },
  { id: 'mg', name: 'Держатель', role: 'mount-glass', prices: allColors(622) },
  { id: 'ce', name: 'Заглушка торцевая', role: 'cap-end', prices: allColors(98) },
  { id: 'p', name: 'Профиль FDPA-51', role: 'profile', stocks: [{ len: 2200, prices: allColors(712) }, { len: 3000, prices: allColors(900) }] },
  { id: 't', name: 'Труба FDT-352', role: 'tube', stocks: [{ len: 2000, prices: allColors(2175) }] },
] }
const item = (dims: { width: number; height: number }): OrderItemInput => ({
  q: computeKitQuantities(buildFromModel(getModel('М1'), dims, 8), 8, getModel('М1')),
  lib: LIB, kit: defaultKitFor(getModel('М1'), LIB), finishId: 'chrome',
})

describe('П7 — общий раскрой на заказ', () => {
  it('общий раскрой не дороже раздельного (экономия ≥ 0)', () => {
    const r = planOrderCutting([item({ width: 1000, height: 2000 }), item({ width: 900, height: 2000 }), item({ width: 1200, height: 2000 })])
    expect(r.pooledTotal).toBeLessThanOrEqual(r.perItemTotal)
    expect(r.saving).toBe(r.perItemTotal - r.pooledTotal)
    expect(r.saving).toBeGreaterThanOrEqual(0)
  })

  it('остатки разных изделий объединяются — хлыстов меньше, чем при раздельном', () => {
    // Только хлыст 2200 (без 3000), тогда остаток напольного куска одного изделия
    // принимает напольный кусок другого — при раздельном раскрое этот остаток пропал бы.
    const lib2200: Library = { items: LIB.items.map(i => i.id === 'p' ? { ...i, stocks: [{ len: 2200, prices: allColors(712) }] } : i) }
    const mk = (w: number): OrderItemInput => ({
      q: computeKitQuantities(buildFromModel(getModel('М1'), { width: w, height: 2000 }, 8), 8, getModel('М1')),
      lib: lib2200, kit: defaultKitFor(getModel('М1'), lib2200), finishId: 'chrome',
    })
    const r = planOrderCutting([mk(1000), mk(1000)])
    const profile = r.cuts.find(c => c.role === 'profile')!
    expect(profile.pooledBars).toBeLessThan(profile.perItemBars)
    expect(profile.saving).toBeGreaterThan(0)
  })

  it('пул только по одной позиции — разные артикулы не смешиваются', () => {
    const libB: Library = { items: LIB.items.map(i => i.id === 'p' ? { ...i, id: 'p2', name: 'Профиль другой' } : i) }
    const a = item({ width: 1000, height: 2000 })
    const b: OrderItemInput = { ...item({ width: 1000, height: 2000 }), lib: libB, kit: defaultKitFor(getModel('М1'), libB) }
    const r = planOrderCutting([a, b])
    // два разных профиля → две группы, ни одна не объединилась
    expect(r.cuts.filter(c => c.role === 'profile').length).toBe(2)
  })

  it('обрезь считается в метраже: куплено ≥ ушло в изделия', () => {
    const r = planOrderCutting([item({ width: 1000, height: 2000 })])
    expect(r.offcutMm).toBeGreaterThanOrEqual(0)
  })

  it('одно изделие — экономии нет (раздельный = общий)', () => {
    const r = planOrderCutting([item({ width: 1100, height: 2100 })])
    expect(r.saving).toBe(0)
  })
})
