import { describe, it, expect } from 'vitest'
import { cleanupLibrary, addVariant, itemKey, refMismatch } from '@/lib/configurator/libraryCleanup'
import { computeKitQuantities, computeKitPrice, normalizeKit, type Library, type KitRates, type ModelKit } from '@/lib/configurator/kit'
import { buildWithVariant } from '@/lib/configurator/quoteContract'
import { M_MODELS } from '@/lib/configurator/arrangement'
import live from '../fixtures/configurator/budget-live-2026-10-01.json'

const LIB = live.library as Library
const KITS = Object.fromEntries(Object.entries(live.kits).map(([c, k]) => [c, normalizeKit(k) ?? { slots: [] }])) as Record<string, ModelKit>
const RATES = live.rates as KitRates
const FIN = live.finance as { marginPct: number; taxPct: number }

const totals = (lib: Library, kits: Record<string, ModelKit>) => Object.fromEntries(M_MODELS.flatMap(m => ['chrome', 'black'].map(f => {
  const c = m.constraints
  const dims = { width: Math.round((c.width[0] + c.width[1]) / 20) * 10, height: 2000,
    width2: c.needsWidth2 && c.width2 ? Math.round((c.width2[0] + c.width2[1]) / 20) * 10 : undefined,
    doorWidth: c.doorWidth ? Math.round((c.doorWidth[0] + c.doorWidth[1]) / 20) * 10 : undefined }
  const q = computeKitQuantities(buildWithVariant(m, dims, 8), 8, m, RATES.capMargin)
  return [`${m.code} ${f}`, Math.round(computeKitPrice(q, lib, kits[m.code] ?? { slots: [] }, RATES, FIN, { finishId: f, withDelivery: false }).hardwareCost)]
})))

describe('Э3 — чистка библиотеки budget (данные 01.10)', () => {
  const { library, kits, report } = cleanupLibrary(LIB, KITS)

  it('одна деталь — одна позиция', () => {
    const keys = library.items.map(itemKey)
    expect(new Set(keys).size).toBe(keys.length)
    expect(library.items.length).toBeLessThan(LIB.items.length)
  })

  it('каждая запись комплекта ведёт на живую позицию, в слоте без повторов', () => {
    const ids = new Set(library.items.map(i => i.id))
    for (const k of Object.values(kits)) for (const s of k.slots) {
      expect(s.entries.every(e => ids.has(e.itemId))).toBe(true)
      expect(new Set(s.entries.map(e => e.itemId)).size).toBe(s.entries.length)
    }
  })

  it('«Держатель FDC-35» со ссылкой на FDC-33 — ссылка исправлена', () => {
    expect(report.refFixed.map(r => `${r.from} → ${r.to}`)).toContain('FDC-33 SUS304 → FDC-35 SUS304')
  })

  it('уценка, не стоящая ни в одной модели, удалена', () => {
    expect(report.dropped.some(d => /FDC-34-DEF/.test(d.name))).toBe(true)
  })

  // Чистка склеивает копии, а не правит цены. Единственный сдвиг — М7 в хроме: держатель
  // «FDC-35» стоял со ссылкой и хромовой ценой FDC-33 (540 ₽), после починки ссылки он —
  // та же деталь, что у остальных моделей (622 ₽). Чёрный у него и раньше был 622.
  it('итоги 9 моделей не меняются, кроме объяснённого М7 хром +82 ₽', () => {
    const before = totals(LIB, KITS)
    const after = totals(library, kits)
    const diff = Object.fromEntries(Object.keys(before).filter(k => before[k] !== after[k]).map(k => [k, after[k] - before[k]]))
    expect(diff).toEqual({ 'М7 chrome': 82 })
  })
})

describe('Ходовая позиция — дополнительный вариант без ★', () => {
  it('ставится в слот роли, умолчание не меняет, копию не плодит', () => {
    const fdp = { id: 'av-fdp232', name: 'Петля Афродита FDP-232 180°', role: 'hinge' as const, prices: { black: 3525 }, ref: { supplier: 'av24', base: 'FDP-232 BR' } }
    const a = addVariant(LIB, KITS, ['М4', 'М7', 'М10'], fdp)
    expect(a.added).toEqual(['М4', 'М7'])                     // у раздвижной М10 петель нет
    const slot = a.kits['М4'].slots.find(s => s.role === 'hinge')!
    expect(slot.entries.find(e => e.itemId === 'av-fdp232')?.primary).toBeUndefined()
    expect(slot.entries.filter(e => e.primary).length).toBe(1)
    const again = addVariant(a.library, a.kits, ['М4'], { ...fdp, id: 'другой-id' })
    expect(again.library.items.length).toBe(a.library.items.length)
    expect(again.added).toEqual([])

    const allSlot: Record<string, ModelKit> = { X: { slots: [{ role: 'hinge', select: 'all', entries: [{ itemId: 'h', qty: { mode: 'role' } }] }] } }
    expect(addVariant(LIB, allSlot, ['X'], fdp).added).toEqual([])   // в «работают все» вариант сложился бы в цену
  })

  it('ссылка, разошедшаяся с названием, распознаётся; удлинение артикула — нет', () => {
    expect(refMismatch({ id: 'x', name: 'Держатель стекла FDC-35 сквозной', role: 'mount-glass', ref: { supplier: 'av24', base: 'FDC-33 SUS304' } }))
      .toEqual({ from: 'FDC-33 SUS304', to: 'FDC-35 SUS304' })
    expect(refMismatch({ id: 'y', name: 'Профиль для стекла FDPA-51', role: 'profile', ref: { supplier: 'av24', base: 'FDPA-51.22 AL' } })).toBeNull()
  })
})
