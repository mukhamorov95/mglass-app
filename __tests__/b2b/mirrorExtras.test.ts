import { describe, it, expect } from 'vitest'
import { heaterSale, heatingService, heaterNeedsPsu } from '@/lib/b2b/mirrorExtras'
import { factoryQuoteToItem, type FactoryQuote } from '@/lib/b2bFactoryProducts'
import { treatmentTags } from '@/lib/b2b/itemTreatments'

const h12 = { id: 66, name: 'Подогрев 12V', short_name: 'EL-12', cost_price: 124, sale_price: null, voltage: 12 }

describe('подогрев зеркала', () => {
  it('продажа из справочника, иначе по марже производства', () => {
    expect(heaterSale({ ...h12, sale_price: 1051 }, 40, 12)).toEqual({ sale: 1051, fromDirectory: true })
    expect(heaterSale(h12, 40, 12)).toEqual({ sale: Math.round(124 / 0.48), fromDirectory: false })
  })
  it('строка × количество, себестоимость тоже', () => {
    expect(heatingService({ ...h12, sale_price: 1000 }, 2, 40, 12)).toMatchObject({ value: 2000, cost_price: 248, name: 'Подогрев EL-12 × 2' })
    expect(heatingService({ ...h12, cost_price: 0 }, 1, 40, 12)).toBeNull()
  })
  it('12 V без подсветки — нужен блок питания', () => {
    expect(heaterNeedsPsu(h12, false)).toBe(true)
    expect(heaterNeedsPsu(h12, true)).toBe(false)
    expect(heaterNeedsPsu({ ...h12, voltage: 220 }, false)).toBe(false)
  })
})

describe('изделие с работами сверху', () => {
  const q: FactoryQuote = {
    label: 'Зеркало', spec: '', widthMm: 600, heightMm: 800, thicknessMm: 4, perimeterM: 2.8,
    areaPiece: 0.48, weightPerPiece: 4.8, factoryCostPiece: 3000, prodPricePiece: 6000, transferPricePiece: 3300, marginPercent: 40,
  }
  it('цена и себестоимость растут на строки × изделий, цех видит вырез и отверстия', () => {
    const svc = [
      { id: 29, name: 'Вырез внешний I кат. × 1', type: 'fixed' as const, value: 401, cost_price: 100, description: '', active: true, sort_order: 0 },
      { id: -600066, name: 'Подогрев EL-12 × 1', type: 'fixed' as const, value: 1051, cost_price: 124, description: '', active: true, sort_order: 0 },
    ]
    const it2 = factoryQuoteToItem(q, 2, undefined, { services: svc, cutoutGroups: [{ kind: 'outer', cat: 1, n: 1 }], holes: [{ d: 20, n: 2 }] })
    const base = factoryQuoteToItem(q, 2)
    expect(it2.saleIncVat).toBe(base.saleIncVat + 2 * (401 + 1051))
    expect(it2.costWithVat).toBe(base.costWithVat + 2 * (100 + 124))
    expect(it2.servicesCost).toBe(2 * (401 + 1051))
    expect(it2.hasHoles).toBe(true)
    const tags = treatmentTags(it2)
    expect(tags).toContain('вырез внешний I кат. × 1')
    expect(tags.some(t => t.startsWith('отв. 2×⌀20'))).toBe(true)
  })
})
