import { describe, it, expect } from 'vitest'
import { prepPricedMaterials } from '@/lib/b2bMaterialPricing'
import { ratesFromRows } from '@/lib/b2b/rates'
import type { B2BMaterial } from '@/lib/types'
import type { SupplierRowLike } from '@/lib/supplier/colorCode'
import { defaultArticle, planStrips, priceComposition, stockLengthMm, type CompositionInput } from '@/lib/calc/composition'
import F from '../fixtures/calc/composition-0014-6.json'

const glass = prepPricedMaterials([F.material as unknown as B2BMaterial], F.matrix)[0]
const ctx = (over: Partial<Parameters<typeof priceComposition>[1]> = {}) => ({
  glass, glassAsked: 'CrystalVision Matelux 8 мм', rates: ratesFromRows(F.rates).rates,
  mgDiscount: F.mgDiscount, av24: F.av24 as SupplierRowLike[], ...over,
})

// Чертёж 0014-6 так, как его прочитал человек 08.10: ширина двери выведена из ниши 888.
const D: CompositionInput = {
  finishId: 'satin',
  panels: [
    { label: 'Дверь 1', w: 424, h: 2004, derived: true },
    { label: 'Дверь 2', w: 424, h: 2004, derived: true },
  ],
  hardware: [
    { role: 'hinge', label: 'Петля стена-стекло 90°', article: 'FDP-230', qty: 4 },
    { role: 'handle', label: 'Ручка-скоба', article: 'FDR-90', qty: 2 },
    { role: 'seal-hinge', label: 'Уплотнитель у стены', article: null, pieces_mm: [2004, 2004] },
    { role: 'seal-magnet', label: 'Уплотнитель магнитный 180°', article: null, pieces_mm: [2004] },
    { role: 'seal-bottom', label: 'Уплотнитель низ', article: null, pieces_mm: [424, 424] },
    { role: 'threshold', label: 'Порог акриловый 16х8', article: null, pieces_mm: [888] },
  ],
}

describe('priceComposition — эталон 0014-6', () => {
  const r = priceComposition(D, ctx())

  it('стекло 2 × 4 486 = 8 972 для M GLASS, как ручной расчёт 08.10', () => {
    expect(r.glass.material).toBe('CrystalVision Matelux')
    expect(r.glass.discountPct).toBe(20)
    expect(r.glass.lines.map(l => l.total)).toEqual([4486, 4486])
    expect(r.glass.cost).toBe(8972)
  })

  it('фурнитура 18 202,5 → 18 203: артикулы по цвету, расходники прозрачные, погонное полосами', () => {
    expect(r.hardware.lines.map(l => [l.article, l.qty, l.total])).toEqual([
      ['FDP-230 BR/SSS', 4, 12900],
      ['FDR-90 SUS304/SSS', 2, 3150],
      ['FDPP-404.8 PVC/CL', 2, 375],
      ['FDPP-503.8 PVC/CL-W', 1, 1275],
      ['FDPP-402.8 PVC/CL', 1, 187.5],
      ['FDPP-16.1 PVC/CL', 1, 315],
    ])
    expect(r.hardware.costExact).toBe(18202.5)
    expect(r.hardware.cost).toBe(18203)
  })

  it('полный расчёт; допущения — в пометках, не в остановках', () => {
    expect(r.stops).toEqual([])
    expect(r.complete).toBe(true)
    expect(r.doors).toBe(2)
    expect(r.notes).toContain('Дверь 1: 424 × 2004 выведен из цепочки размеров — проверьте')
    expect(r.notes).toContain('Уплотнитель у стены: артикула на чертеже нет — взят ходовой FDPP-404.8')
    expect(r.hardware.lines.filter(l => !l.fromDrawing)).toHaveLength(4)
    expect(r.hardware.lines[3].layout).toEqual([[2004]])
    expect(r.hardware.lines[4].layout).toEqual([[424, 424]])
  })

  it('чёрная фурнитура — свои чёрные строки, и у расходников тоже', () => {
    const b = priceComposition({ ...D, finishId: 'black' }, ctx())
    expect(b.hardware.lines.map(l => l.article)).toEqual([
      'FDP-230 BR/BL', 'FDR-90 SUS304/BL', 'FDPP-404.8 PVC/BL', 'FDPP-503.8 PVC/BL', 'FDPP-402.8 PVC/BL', 'FDPP-16.1 PVC/BL',
    ])
  })
})

describe('остановка, а не догадка', () => {
  it('артикула нет в справочнике', () => {
    const r = priceComposition({ ...D, hardware: [{ role: 'hinge', label: 'Петля', article: 'FDP-999', qty: 2 }] }, ctx())
    expect(r.stops).toEqual(['Петля: FDP-999 нет в справочнике АВ24'])
    expect(r.complete).toBe(false)
    expect(r.hardware.cost).toBe(0)
  })

  it('нет строки нужного цвета — не подставляем чужой', () => {
    const r = priceComposition({ ...D, finishId: 'white', hardware: [D.hardware[1]] }, ctx())
    expect(r.stops).toEqual(['Ручка-скоба: у FDR-90 SUS304 нет цены нужного цвета'])
  })

  it('кусок длиннее полосы — стык решает владелец', () => {
    const r = priceComposition({ ...D, hardware: [{ role: 'seal-hinge', label: 'Уплотнитель', article: 'FDPP-404.8', pieces_mm: [2400] }] }, ctx())
    expect(r.stops).toEqual(['Уплотнитель: кусок 2400 мм длиннее полосы 2200 мм'])
  })

  it('у подписи несколько исполнений — просим уточнить', () => {
    const av24 = [...F.av24, { article: 'FDP-230 ZN/SSS', name: 'Петля FDP-230, цинк/матовый', color: 'матовый', retail_price: 3000, discount_percent: 25, cost_price: 2250 }]
    const r = priceComposition({ ...D, hardware: [D.hardware[0]] }, ctx({ av24 }))
    expect(r.stops).toEqual(['Петля стена-стекло 90°: у FDP-230 несколько исполнений (FDP-230 BR, FDP-230 ZN) — уточните артикул'])
  })

  it('нет стекла в справочнике — фурнитура всё равно посчитана, расчёт неполный', () => {
    const r = priceComposition(D, ctx({ glass: null, glassAsked: 'Стекло X 8 мм' }))
    expect(r.stops).toEqual(['Стекла «Стекло X 8 мм» нет в справочнике B2B — цена стекла не посчитана'])
    expect(r.glass.cost).toBe(0)
    expect(r.hardware.cost).toBe(18203)
  })

  it('не прочитано количество или длины', () => {
    const r = priceComposition({ ...D, hardware: [
      { role: 'handle', label: 'Ручка', article: 'FDR-90' },
      { role: 'seal-bottom', label: 'Низ', article: null, pieces_mm: [] },
      { role: 'other', label: 'Держатель', article: null, qty: 1 },
    ] }, ctx())
    expect(r.stops).toEqual([
      'Ручка: не прочитано количество',
      'Низ: не прочитаны длины кусков',
      'Держатель: нет артикула на чертеже и нет ходовой позиции — укажите артикул',
    ])
  })
})

describe('ходовые позиции и полосы', () => {
  it('магнитный: есть 90 → 502.8 (у АВ24 он «90°, 180°»), только 180 или без угла → 503.8', () => {
    expect(defaultArticle('seal-magnet', 'Магнитный 90°')).toBe('FDPP-502.8')
    expect(defaultArticle('seal-magnet', 'Магнитный 90°, 180°')).toBe('FDPP-502.8')
    expect(defaultArticle('seal-magnet', 'Магнитный 180°')).toBe('FDPP-503.8')
    expect(defaultArticle('seal-magnet', 'Магнитный 1900 мм')).toBe('FDPP-503.8')
    expect(defaultArticle('seal-magnet', 'Магнитный')).toBe('FDPP-503.8')
  })

  it('порог: до 1 м — FDPP-16.1, длиннее — FDPP-16.2', () => {
    expect(defaultArticle('threshold', 'Порог', [888])).toBe('FDPP-16.1')
    expect(defaultArticle('threshold', 'Порог', [1450])).toBe('FDPP-16.2')
  })

  it('длина полосы из названия, «мм» не путается с «м»', () => {
    expect(stockLengthMm('Уплотнитель ПРЕМИУМ Ч-образный прозрачный 2.2 м, ус 18 мм под стекло 8 мм FDPP-402.8')).toBe(2200)
    expect(stockLengthMm('Порог акриловый для душевой 16х8 мм, 1 м прозрачный FDPP-16.1')).toBe(1000)
    expect(stockLengthMm('Ручка скоба FDR-90, 10х15х220х1.0 мм')).toBeNull()
  })

  it('раскладка: большие первыми, каждый в первую полосу, где хватает', () => {
    expect(planStrips([424, 424, 2004], 2200)).toEqual({ layout: [[2004], [424, 424]], tooLong: [] })
    expect(planStrips([1100, 1100], 2200).layout).toEqual([[1100, 1100]])
    expect(planStrips([2300], 2200)).toEqual({ layout: [], tooLong: [2300] })
  })
})
