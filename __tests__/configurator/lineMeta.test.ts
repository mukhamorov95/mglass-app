import { describe, it, expect } from 'vitest'
import { computeKitQuantities, computeKitPrice, type Library, type ModelKit, type KitRates, type RoleId } from '@/lib/configurator/kit'
import { buildWithVariant } from '@/lib/configurator/quoteContract'
import { getModel } from '@/lib/configurator/arrangement'

// Э4: строка фурнитуры несёт артикул, поставщика и дату цены, а подмена цены цвета
// ценой хрома видна меткой. Цена и complete от меток не меняются.
const ref = (base: string, asOf?: string) => ({ supplier: 'av24', base, ...(asOf ? { asOf } : {}) })
const LIB: Library = { items: [
  { id: 'hinge', name: 'Петля FDP-232', role: 'hinge', prices: { chrome: 3000, black: 3300 }, ref: ref('FDP-232 BR', '2026-08-19') },
  { id: 'wall', name: 'Держатель FDC-38', role: 'mount-wall', prices: { chrome: 700 }, ref: ref('FDC-38 SUS304') },
  { id: 'profile', name: 'Профиль FDPA-55', role: 'profile', ref: ref('FDPA-55.22 AL'), stocks: [
    { len: 2200, prices: { chrome: 600, black: 660 }, ref: ref('FDPA-55.22 AL', '2026-08-19') },
    { len: 3000, prices: { chrome: 800 }, ref: ref('FDPA-55.3 AL', '2026-08-20') },
  ] },
] }
const slot = (role: RoleId, itemId: string) => ({ role, select: 'one' as const, entries: [{ itemId, qty: { mode: 'role' as const }, primary: true }] })
const KIT: ModelKit = { slots: [slot('hinge', 'hinge'), slot('mount-wall', 'wall'), slot('profile', 'profile')] }
const RATES: KitRates = { glassPerM2: {}, installPerSection: 0, deliveryMoscow: 0, liftPerFloor: 0 }
const m = getModel('М4')
const q = computeKitQuantities(buildWithVariant(m, { width: 1450, height: 2000, doorWidth: 650 }, 8), 8, m)
const price = (finishId: string) => computeKitPrice(q, LIB, KIT, RATES, { marginPct: 40, taxPct: 12 }, { finishId, withDelivery: false })
const line = (finishId: string, id: string) => price(finishId).lines.find(l => l.itemId === id)!

describe('Метки строки фурнитуры (Э4)', () => {
  it('артикул, поставщик и дата цены приходят в строку', () => {
    expect(line('black', 'hinge').ref).toEqual(ref('FDP-232 BR', '2026-08-19'))
    expect(line('black', 'wall').ref).toEqual(ref('FDC-38 SUS304'))
  })

  it('нет цены цвета — строка помечена «цена хрома», сумма та же', () => {
    const w = line('black', 'wall')
    expect(w.chromeFallback).toBe(true)
    expect(w.unitPrice).toBe(700)
    expect(line('black', 'hinge').chromeFallback).toBeUndefined()
    expect(line('chrome', 'wall').chromeFallback).toBeUndefined()
  })

  it('хлыст: ссылка — той длины, что ушла в раскрой; метка — если у неё нет цвета', () => {
    const p = line('black', 'profile')
    const lens = new Set(p.plan!.map(b => b.len))
    const used = LIB.items[2].stocks!.filter(s => lens.has(s.len))
    expect(p.ref).toEqual(used[0].ref)
    expect(!!p.chromeFallback).toBe(used.some(s => !s.prices.black))
  })

  it('метки не трогают complete и итог', () => {
    const a = price('black')
    const noRef = structuredClone(LIB)
    for (const it of noRef.items) { delete it.ref; for (const st of it.stocks ?? []) delete st.ref }
    const b = computeKitPrice(q, noRef, KIT, RATES, { marginPct: 40, taxPct: 12 }, { finishId: 'black', withDelivery: false })
    expect(a.hardwareCost).toBe(b.hardwareCost)
    expect(a.complete).toBe(b.complete)
  })
})
