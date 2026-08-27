import { describe, it, expect } from 'vitest'
import { calcLoftFactory, type LoftFactoryInputs, type LoftRates } from '../lib/loftFactoryCalculator'

// Стекло в лофте опционально: цех продаёт и голый каркас. Проверяем, что без
// стекла исчезают ИМЕННО связанные со стеклом строки, а каркасные остаются —
// иначе «каркас» посчитается как полное изделие и уйдёт клиенту дешевле себестоимости
// либо, наоборот, с оплатой работы, которой не было.

const rates: LoftRates = {
  profile_m: 500, shtapik_m: 200, bonka_pt: 30,
  consumables_m: 40, weld_m2: 1500, paint_oven: 6000,
  glazing_m2: 900, glass_waste_pct: 10,
}

const base: LoftFactoryInputs = {
  widthMm: 900, heightMm: 2800,
  construction: 'fixed', doors: 0, fixedParts: 1, rows: 1,
  handle: 'corner', softClose: false,
  glassCostPerM2: 2000, glassName: 'Стекло Mopy Crystal Clear 4 мм',
  tempering: true, temperingCostPerM2: 800,
}

const names = (r: { costLines: { name: string }[] }) => r.costLines.map(l => l.name)

describe('лофт: стекло опционально', () => {
  it('со стеклом считает стекло, закалку и остекление', () => {
    const r = calcLoftFactory(base, rates)!
    expect(r).toBeTruthy()
    expect(names(r)).toContain('Стекло Mopy Crystal Clear 4 мм')
    expect(names(r)).toContain('Закалка')
    expect(names(r).some(n => n.startsWith('Остекление'))).toBe(true)
  })

  it('без стекла эти три строки исчезают', () => {
    const r = calcLoftFactory({ ...base, withGlass: false }, rates)!
    expect(r).toBeTruthy()
    expect(names(r)).not.toContain('Стекло Mopy Crystal Clear 4 мм')
    expect(names(r)).not.toContain('Закалка')
    expect(names(r).some(n => n.startsWith('Остекление'))).toBe(false)
  })

  it('без стекла каркасные работы остаются — это не «пустой» расчёт', () => {
    const r = calcLoftFactory({ ...base, withGlass: false }, rates)!
    expect(names(r)).toContain('Работа сварщика')
    expect(names(r)).toContain('Покраска порошковая (RAL)')
    expect(r.totalCost).toBeGreaterThan(0)
  })

  it('каркас дешевле полного изделия ровно на стекло + закалку + остекление', () => {
    const full = calcLoftFactory(base, rates)!
    const frame = calcLoftFactory({ ...base, withGlass: false }, rates)!
    const glassSide = full.costLines
      .filter(l => l.name === base.glassName || l.name === 'Закалка' || l.name.startsWith('Остекление'))
      .reduce((s, l) => s + l.total, 0)
    expect(glassSide).toBeGreaterThan(0)
    expect(full.totalCost - frame.totalCost).toBe(glassSide)
  })

  it('вес каркаса не включает стекло', () => {
    const full = calcLoftFactory(base, rates)!
    const frame = calcLoftFactory({ ...base, withGlass: false }, rates)!
    expect(frame.weightKg).toBeLessThan(full.weightKg)
  })

  it('в спецификации каркаса написано «без стекла», а не название стекла', () => {
    const frame = calcLoftFactory({ ...base, withGlass: false }, rates)!
    expect(frame.spec).toContain('без стекла')
    expect(frame.spec).not.toContain('Mopy')
    expect(frame.spec).not.toContain('закалка')
  })

  it('закалка без стекла не появляется, даже если галка стоит', () => {
    const frame = calcLoftFactory({ ...base, withGlass: false, tempering: true }, rates)!
    expect(names(frame)).not.toContain('Закалка')
  })
})
