import { describe, it, expect } from 'vitest'
import { prepPricedMaterials } from '@/lib/b2bMaterialPricing'
import { ratesFromRows } from '@/lib/b2b/rates'
import type { B2BMaterial } from '@/lib/types'
import type { SupplierRowLike } from '@/lib/supplier/colorCode'
import { priceComposition, type CompositionRole } from '@/lib/calc/composition'
import { COMPOSE_TEMPLATES, applyTemplate, resolveLen, resolvePieces } from '@/lib/calc/composeTemplates'
import F from '../fixtures/calc/composition-0014-6.json'

let n = 0
const uid = () => `p${++n}`
const tpl = (id: string) => COMPOSE_TEMPLATES.find(t => t.id === id)!

describe('resolveLen — длина куска от размеров стёкол', () => {
  const panels = [
    { id: 'a', w: 900, h: 2000, run: 'side' as const },
    { id: 'b', w: 300, h: 2000, run: 'front' as const },
    { id: 'c', w: 700, h: 1950 },
  ]
  it('размер стекла, запас, сумма ширин по стороне, высота стороны — наибольшая', () => {
    expect(resolveLen({ panelId: 'c', dim: 'w', plus: 50 }, panels)).toBe(750)
    expect(resolveLen({ run: 'front', dim: 'w' }, panels)).toBe(1000)
    expect(resolveLen({ run: 'side', dim: 'w' }, panels)).toBe(900)
    expect(resolveLen({ run: 'front', dim: 'h' }, panels)).toBe(2000)
  })
  it('удалённое или пустое стекло — куска нет, а не кусок «50 мм»', () => {
    expect(resolvePieces([{ panelId: 'x', dim: 'h' }, { panelId: 'c', dim: 'h' }], panels)).toEqual([1950])
    expect(resolveLen({ panelId: 'b', dim: 'w', plus: 50 }, [{ id: 'b', w: 0, h: 0 }])).toBe(0)
  })
})

describe('шаблоны', () => {
  it('каждая длина ссылается на стекло шаблона, ключи стёкол уникальны', () => {
    for (const t of COMPOSE_TEMPLATES) {
      const keys = t.panels.map(p => p.key)
      expect(new Set(keys).size, t.id).toBe(keys.length)
      for (const h of t.hardware) {
        expect(!!h.qty !== !!h.pieces, `${t.id} ${h.base}: или штуки, или куски`).toBe(true)
        for (const l of h.pieces ?? []) expect(l.panel ? keys.includes(l.panel) : !!l.run, `${t.id} ${h.base}`).toBe(true)
      }
    }
  })

  it('длины следуют за размерами: шире дверь — длиннее заглушка, низ и профиль по фронту', () => {
    const a = applyTemplate(tpl('corner-swing'), uid)
    const door = a.panels.find(p => p.label === 'Дверь')!
    const sizes = a.panels.map(p => ({ id: p.id, w: p.id === door.id ? 800 : Number(p.w), h: Number(p.h), run: p.run }))
    const of = (base: string) => resolvePieces(a.hardware.find(h => h.base === base)!.auto!, sizes)
    expect(of('FDPA-500.1 AL')).toEqual([850])
    expect(of('FDPP-406.8 PVC')).toEqual([800])
    expect(of('FDPA-51.22 AL')).toEqual([2000, 2000, 1100, 900])
    expect(of('FDT-352 SUS304')).toEqual([1100])
  })

  it('«Две двери в нишу» на размерах 0014-6 — те же 8 972 стекла и 18 203 фурнитуры', () => {
    const a = applyTemplate(tpl('niche-two-doors'), uid)
    const sizes = a.panels.map(p => ({ id: p.id, w: 424, h: 2004, run: p.run }))
    // Роли — как в каталоге конструктора (lib/calc/compositionCatalog.ts).
    const ROLE: Record<string, CompositionRole> = { 'FDP-230 BR': 'hinge', 'FDR-90 SUS304': 'handle', 'FDPP-16.1 PVC': 'threshold' }
    const r = priceComposition({
      finishId: 'satin',
      panels: sizes.map((p, i) => ({ label: `Дверь ${i + 1}`, w: p.w, h: p.h })),
      hardware: a.hardware.map(h => ({
        role: ROLE[h.base] ?? 'seal', label: h.base, article: h.base,
        ...(h.auto ? { pieces_mm: resolvePieces(h.auto, sizes) } : { qty: h.qty }),
      })),
    }, {
      glass: prepPricedMaterials([F.material as unknown as B2BMaterial], F.matrix)[0], glassAsked: 'CrystalVision Matelux 8 мм',
      rates: ratesFromRows(F.rates).rates, mgDiscount: F.mgDiscount, av24: F.av24 as SupplierRowLike[],
    })
    expect(r.stops).toEqual([])
    expect(r.glass.cost).toBe(8972)
    expect(r.hardware.cost).toBe(18203)
  })
})
