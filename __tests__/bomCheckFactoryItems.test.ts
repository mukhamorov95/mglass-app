import { describe, it, expect } from 'vitest'
import { checkQuoteBom, type BomCheckItem } from '../lib/b2b/bomCheck'

// Изделия производства (зеркало с подсветкой, лофт) приходят в просчёт с
// materialId = 0 и собственной себестоимостью — в справочнике листовых материалов
// их нет и быть не должно. Проверяем, что «нормальная» позиция из справочника
// молчит: раньше изделия попадали в fallback с active:false и КАЖДОЕ получало
// «материал выключен» + «не привязан к прайсу». Предупреждение, срабатывающее
// всегда, перестают читать — и оно не сработает там, где себестоимость реально нулевая.

const ref = { facetPrices: [], pricedMaterials: new Set(['Осветлённое|mirror']) }

const good: BomCheckItem = {
  material: { name: 'Осветлённое', category: 'зеркало', thickness: 4, cost_price: 1180, active: true },
  hasTempering: false, hasFacet: false, facetTypeMm: null, hasTriplex: false, triplexPrice: null, services: [],
}

describe('проверка спецификации: ложные срабатывания', () => {
  it('исправный материал из справочника не даёт ни одного замечания', () => {
    expect(checkQuoteBom([good], ref)).toHaveLength(0)
  })

  it('выключенный материал по-прежнему ловится', () => {
    const issues = checkQuoteBom([{ ...good, material: { ...good.material, active: false } }], ref)
    expect(issues.some(i => i.code === 'material_inactive')).toBe(true)
  })

  it('нулевая себестоимость по-прежнему ловится — ради этого проверка и существует', () => {
    const issues = checkQuoteBom([{ ...good, material: { ...good.material, cost_price: 0 } }], ref)
    expect(issues.some(i => i.code === 'material_no_cost')).toBe(true)
  })

  it('непривязка к прайсу поставщика ловится', () => {
    const issues = checkQuoteBom([{ ...good, material: { ...good.material, name: 'Неизвестное' } }], ref)
    expect(issues.some(i => i.code === 'supplier_price_unmapped')).toBe(true)
  })
})
