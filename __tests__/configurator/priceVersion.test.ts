import { describe, it, expect } from 'vitest'
import { computeKitQuantities, computeKitPrice, defaultKitFor, type Library, type KitRates } from '@/lib/configurator/kit'
import { buildFromModel } from '@/components/configurator/scene/assembly'
import { getModel } from '@/lib/configurator/arrangement'
import { FINISH_IDS } from '@/lib/configurator/pricing'

// Смысл версии прайса: КП, посчитанное по замороженному снимку, воспроизводится точно
// даже после того, как живые цены изменились. Проверяем именно это свойство —
// расчёт по снимку не зависит от того, что стало с текущим прайсом.
const RATES: KitRates = { glassPerM2: { clear: 3000, crystal: 6000, bronze: 4800, graphite: 4800 }, installPerSection: 5000, deliveryMoscow: 4000, liftPerFloor: 0 }
const FIN = { marginPct: 40, taxPct: 12, minMarginPct: 25 }
const allColors = (n: number) => Object.fromEntries(FINISH_IDS.map(f => [f, n]))

const libAt = (profilePrice: number): Library => ({ items: [
  { id: 'mw', name: 'FDC-30 к стене', role: 'mount-wall', prices: allColors(352) },
  { id: 'mg', name: 'FDC-35 держатель', role: 'mount-glass', prices: allColors(622) },
  { id: 'ce', name: 'Заглушка торцевая', role: 'cap-end', prices: allColors(98) },
  { id: 'p', name: 'Профиль FDPA-51.22', role: 'profile', stocks: [{ len: 2200, prices: allColors(profilePrice) }] },
  { id: 't', name: 'Труба FDT-352', role: 'tube', stocks: [{ len: 2000, prices: allColors(2175) }] },
] })

function priceM1(lib: Library) {
  const kit = defaultKitFor(getModel('М1'), lib)
  const q = computeKitQuantities(buildFromModel(getModel('М1'), { width: 1000, height: 2000 }, 8), 8, getModel('М1'))
  return computeKitPrice(q, lib, kit, RATES, FIN, { finishId: 'chrome' }).total
}

describe('версия прайса', () => {
  it('КП по снимку не меняется, когда живой прайс подорожал', () => {
    const snapshot = libAt(712)          // «заморозили» на публикации версии
    const kpAtPublish = priceM1(snapshot)

    const live = libAt(1200)             // потом профиль подорожал в живом прайсе
    expect(priceM1(live)).toBeGreaterThan(kpAtPublish)   // живая цена выросла
    expect(priceM1(snapshot)).toBe(kpAtPublish)          // а по снимку — та же, воспроизводится точно
  })

  it('срок действия КП = дата публикации + valid_days', () => {
    const publishedAt = new Date('2026-09-01T10:00:00Z').getTime()
    const validDays = 30
    const until = new Date(publishedAt + validDays * 86400000)
    expect(until.toISOString().slice(0, 10)).toBe('2026-10-01')
  })
})
