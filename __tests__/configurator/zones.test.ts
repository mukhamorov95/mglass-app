import { describe, it, expect } from 'vitest'
import { computeKitQuantities, computeKitPrice, defaultKitFor, type Library, type KitRates } from '@/lib/configurator/kit'
import { buildFromModel } from '@/components/configurator/scene/assembly'
import { getModel } from '@/lib/configurator/arrangement'
import { FINISH_IDS } from '@/lib/configurator/pricing'

const allColors = (n: number) => Object.fromEntries(FINISH_IDS.map(f => [f, n]))
const LIB: Library = { items: [
  { id: 'mw', name: 'К стене', role: 'mount-wall', prices: allColors(352) },
  { id: 'mg', name: 'Держатель', role: 'mount-glass', prices: allColors(622) },
  { id: 'ce', name: 'Заглушка торцевая', role: 'cap-end', prices: allColors(98) },
  { id: 'p', name: 'Профиль', role: 'profile', stocks: [{ len: 2200, prices: allColors(712) }] },
  { id: 't', name: 'Труба', role: 'tube', stocks: [{ len: 2000, prices: allColors(2175) }] },
] }
const FIN = { marginPct: 40, taxPct: 12, minMarginPct: 25 }
const base: KitRates = {
  glassPerM2: { clear: 3000 }, installPerSection: 5000, deliveryMoscow: 4000, liftPerFloor: 500,
  deliveryZones: [
    { id: 'msk', label: 'Москва', base: 4000 },
    { id: 'mo50', label: 'МО до 50 км', base: 6000, perKm: 40, maxKm: 50 },
    { id: 'reg', label: 'Регион', base: 9000, perKm: 25 },
  ],
  installSurcharges: [
    { id: 'tile', label: 'Плитка/камень', kind: 'per-section', amount: 1500 },
    { id: 'stairs', label: 'Подъём по лестнице', kind: 'per-order', amount: 3000 },
  ],
}
const price = (opts: Parameters<typeof computeKitPrice>[5]) => {
  const q = computeKitQuantities(buildFromModel(getModel('М1'), { width: 1000, height: 2000 }, 8), 8, getModel('М1'))
  return computeKitPrice(q, LIB, defaultKitFor(getModel('М1'), LIB), base, FIN, { finishId: 'chrome', ...opts })
}

describe('П5 — монтаж и логистика по зонам', () => {
  it('без зоны — Москва по deliveryMoscow', () => {
    const p = price({})
    expect(p.deliveryZone).toBe('Москва')
    expect(p.deliveryCost).toBe(4000)
  })

  it('зона МО: база + километраж за МКАД', () => {
    const p = price({ zoneId: 'mo50', km: 30 })
    expect(p.deliveryCost).toBe(6000 + 40 * 30)
    expect(p.deliveryZone).toBe('МО до 50 км')
  })

  it('withDelivery=false — доставка ноль', () => {
    expect(price({ zoneId: 'reg', km: 100, withDelivery: false }).deliveryCost).toBe(0)
  })

  it('надбавка за секцию и разовая складываются в монтаж', () => {
    const q = computeKitQuantities(buildFromModel(getModel('М1'), { width: 1000, height: 2000 }, 8), 8, getModel('М1'))
    const p = computeKitPrice(q, LIB, defaultKitFor(getModel('М1'), LIB), base, FIN, { finishId: 'chrome', installFactors: ['tile', 'stairs'] })
    expect(p.installBase).toBe(5000 * q.sections)
    expect(p.installExtra).toBe(1500 * q.sections + 3000)
    expect(p.installCost).toBe(p.installBase + p.installExtra)
  })

  it('этажи умножаются на liftPerFloor', () => {
    expect(price({ floors: 3 }).liftCost).toBe(1500)
  })

  it('итог включает монтаж с надбавками, доставку по зоне и подъём', () => {
    const p = price({ zoneId: 'mo50', km: 10, installFactors: ['stairs'], floors: 2 })
    expect(p.total).toBe(p.itemPrice + p.installCost + p.deliveryCost + p.liftCost)
    expect(p.deliveryCost).toBe(6000 + 400)
    expect(p.installExtra).toBe(3000)
    expect(p.liftCost).toBe(1000)
  })
})
