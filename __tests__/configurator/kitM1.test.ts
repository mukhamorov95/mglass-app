import { describe, it, expect } from 'vitest'
import { computeKitQuantities, computeKitPrice, type Library, type ModelKit, type KitRates } from '@/lib/configurator/kit'
import { buildWithVariant } from '@/lib/configurator/quoteContract'
import { getModel } from '@/lib/configurator/arrangement'
import type { MDims, MVariant } from '@/components/configurator/scene/assembly'

// М1: клиент выбирает крепление штанги (4 варианта) и обвязку профилем (2).
// Прайс не знает про варианты — активный вариант просто даёт свои роли, остальные молчат.
const RATES: KitRates = { glassPerM2: { clear: 3000 }, installPerSection: 5000, deliveryMoscow: 4000, liftPerFloor: 0 }
const FIN = { marginPct: 40, taxPct: 12 }
const q = (variant: MVariant, dims: MDims = { width: 900, height: 2000 }) =>
  computeKitQuantities(buildWithVariant(getModel('М1'), dims, 8, variant), 8, getModel('М1'))

const LIB: Library = { items: [
  { id: 't90', name: 'Труба FDT-351 (1 м)', role: 'tube', stocks: [{ len: 1000, prices: { chrome: 825 } }, { len: 2000, prices: { chrome: 2175 } }] },
  { id: 't45', name: 'Штанга 45°', role: 'tube-diag45', stocks: [{ len: 2000, prices: { chrome: 2175 } }] },
  { id: 'tst', name: 'Стабилизатор FDK-5R', role: 'tube-stabilizer', stocks: [{ len: 1000, prices: { chrome: 3375 } }] },
  { id: 'mw', name: 'FDC-30 к стене', role: 'mount-wall', prices: { chrome: 352 } },
  { id: 'mg', name: 'FDC-35 держатель', role: 'mount-glass', prices: { chrome: 622 } },
  { id: 'md', name: 'Крепление 45°', role: 'mount-diag45', prices: { chrome: 428 } },
  { id: 'ms', name: 'Крепление стабилизатора', role: 'mount-stabilizer', prices: { chrome: 900 } },
  { id: 'pw', name: 'Профиль по стене', role: 'profile-wall', stocks: [{ len: 2200, prices: { chrome: 712 } }] },
  { id: 'pf', name: 'Профиль по полу', role: 'profile-floor', stocks: [{ len: 2200, prices: { chrome: 712 } }] },
  { id: 'pt', name: 'Профиль верхний', role: 'profile-top', stocks: [{ len: 2200, prices: { chrome: 712 } }] },
  { id: 'pv', name: 'Профиль вертикальный', role: 'profile-vertical', stocks: [{ len: 2200, prices: { chrome: 712 } }] },
  { id: 'cp', name: 'Заглушка погонная (1 м)', role: 'cap', stocks: [{ len: 1000, prices: { chrome: 158 } }] },
  { id: 'ce', name: 'Заглушка торцевая', role: 'cap-end', prices: { chrome: 142 } },
] }
const KIT: ModelKit = { slots: LIB.items.map(i => ({ role: i.role, select: 'one' as const, entries: [{ itemId: i.id, qty: { mode: 'role' as const }, primary: true }] })) }

describe('М1 — варианты крепления штанги', () => {
  it('перпендикулярная труба: длина куска = глубина поддона, стандарт 1000', () => {
    expect(q({ mount: 'perp90' }).barPieces['tube']).toEqual([1000])
    expect(q({ mount: 'perp90' }, { width: 900, height: 2000, trayDepth: 1400 }).barPieces['tube']).toEqual([1400])
  })

  it('на стандартном поддоне берётся метровый хлыст, а не двухметровый', () => {
    const p = computeKitPrice(q({ mount: 'perp90' }), LIB, KIT, RATES, FIN, { finishId: 'chrome' })
    const tube = p.lines.find(l => l.role === 'tube')!
    expect(tube.total).toBe(825)
    expect(tube.plan).toEqual([{ len: 1000, price: 825, pieces: [1000], rest: 0 }])
  })

  it('поддон глубже метра — метровой не хватает, берётся двухметровая', () => {
    const p = computeKitPrice(q({ mount: 'perp90' }, { width: 900, height: 2000, trayDepth: 1400 }), LIB, KIT, RATES, FIN, { finishId: 'chrome' })
    expect(p.lines.find(l => l.role === 'tube')!.total).toBe(2175)
  })

  it('каждый вариант даёт свои роли и свою цену, чужие молчат', () => {
    const variants: MVariant['mount'][] = ['perp90', 'diag45', 'stabilizer', 'ceiling']
    const active = variants.map(mount => {
      const qq = q({ mount })
      const p = computeKitPrice(qq, LIB, KIT, RATES, FIN, { finishId: 'chrome' })
      return { mount, roles: p.lines.map(l => l.role).sort(), missing: p.missing.length }
    })
    expect(active[0].roles).toContain('tube')
    expect(active[1].roles).toContain('tube-diag45')
    expect(active[1].roles).not.toContain('tube')
    expect(active[2].roles).toContain('tube-stabilizer')
    expect(active[3].roles).not.toContain('tube')            // в потолок — штанги нет вовсе
    expect(active.every(a => a.missing === 0)).toBe(true)     // незанятые роли не считаются дырой
  })

  it('крепление 45° ставится дважды — так собран узел', () => {
    expect(q({ mount: 'diag45' }).roleQty['mount-diag45']).toBe(2)
  })

  it('вариант «в потолок»: стекло тянется до потолка, профиль по стене/верху/полу', () => {
    const tall = q({ mount: 'ceiling' }, { width: 900, height: 2000, ceilingHeight: 2600 })
    const normal = q({ mount: 'perp90' })
    expect(tall.glassM2).toBeGreaterThan(normal.glassM2)
    expect(tall.barPieces['profile-wall']?.length).toBeGreaterThan(0)
    expect(tall.barPieces['profile-top']?.length).toBeGreaterThan(0)
  })
})

describe('М1 — обвязка профилем', () => {
  it('по периметру дороже частичной: добавляются верх и свободная вертикаль', () => {
    const partial = q({ mount: 'perp90', profileFrame: 'partial' })
    const perimeter = q({ mount: 'perp90', profileFrame: 'perimeter' })
    expect(partial.barPieces['profile-top']).toBeUndefined()
    expect(perimeter.barPieces['profile-top']?.length).toBe(1)
    expect(perimeter.barPieces['profile-vertical']?.length).toBe(1)
    const cost = (qq: ReturnType<typeof q>) => computeKitPrice(qq, LIB, KIT, RATES, FIN, { finishId: 'chrome' }).materialsCost
    expect(cost(perimeter)).toBeGreaterThan(cost(partial))
  })
})
