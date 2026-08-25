import { describe, it, expect } from 'vitest'
import { planB2BOrder, planBomLines, planShortages, type MatchTarget } from '@/lib/inventory/plan'
import { normalizeName, isServiceLine, suggestMatches } from '@/lib/inventory/match'

const glass: MatchTarget = {
  id: 1, name: 'Сатинированное бесцветное 8 мм', unit: 'м2', qty: 20,
  ref_table: 'b2b_materials', ref_id: '24', bom_aliases: [],
}
const hinge: MatchTarget = {
  id: 2, name: 'Петля стена-стекло', unit: 'шт', qty: 6,
  ref_table: 'shower_catalog_items', ref_id: '10', bom_aliases: ['петля настенная'],
}

describe('план списания B2B-заказа', () => {
  const items = [
    { materialId: 24, materialName: 'Сатинированное бесцветное', totalAreaBilled: 0.8153 },
    { materialId: 24, materialName: 'Сатинированное бесцветное', totalAreaBilled: 1.4565 },
    { materialId: 24, materialName: 'Сатинированное бесцветное', totalAreaBilled: 1.3728 },
  ]

  it('одинаковый материал складывается в одну строку', () => {
    const rows = planB2BOrder(items, [glass])
    expect(rows).toHaveLength(1)
    expect(rows[0].qty).toBe(3.6446)
    expect(rows[0].item_id).toBe(1)
    expect(rows[0].matched).toBe('ref')
  })

  it('списывается площадь С РАСКРОЕМ, а не нетто', () => {
    const rows = planB2BOrder([{ materialId: 24, totalAreaNet: 1, totalAreaBilled: 1.231 }], [glass])
    expect(rows[0].qty).toBe(1.231)
  })

  it('материала нет в реестре — строка помечается, а не исчезает', () => {
    const rows = planB2BOrder([{ materialId: 99, materialName: 'Бронза 6', totalAreaBilled: 2 }], [glass])
    expect(rows[0].item_id).toBeNull()
    expect(rows[0].matched).toBe('none')
    expect(rows[0].qty).toBe(2)
  })

  it('позиции без площади не попадают в план', () => {
    expect(planB2BOrder([{ materialId: 24, totalAreaBilled: 0 }], [glass])).toHaveLength(0)
  })
})

describe('план списания B2C-заказа по BOM', () => {
  it('сопоставляет по алиасу и по имени', () => {
    const rows = planBomLines([
      { name: 'петля настенная', qty: 4, unit: 'шт' },
      { name: 'Сатинированное бесцветное 8 мм', qty: 2.43, unit: 'м²' },
    ], [glass, hinge])
    expect(rows.map(r => r.matched)).toEqual(['alias', 'name'])
    expect(rows[0].item_id).toBe(2)
  })

  it('услуги не списываются со склада', () => {
    const rows = planBomLines([
      { name: 'Монтаж душевой', qty: 1, unit: 'компл.' },
      { name: 'Доставка по Москве', qty: 1, unit: 'шт' },
      { name: 'Петля стена-стекло', qty: 2, unit: 'шт' },
    ], [hinge])
    expect(rows).toHaveLength(1)
    expect(rows[0].item_id).toBe(2)
  })

  it('одна позиция из разных строк суммируется', () => {
    const rows = planBomLines([
      { name: 'Петля стена-стекло', qty: 2, unit: 'шт' },
      { name: 'петля настенная',    qty: 3, unit: 'шт' },
    ], [hinge])
    expect(rows).toHaveLength(1)
    expect(rows[0].qty).toBe(5)
  })

  it('нехватка видна до списания', () => {
    const rows = planBomLines([{ name: 'Петля стена-стекло', qty: 10, unit: 'шт' }], [hinge])
    expect(planShortages(rows)).toHaveLength(1)
  })
})

describe('нормализация названий', () => {
  it('регистр, ё и знаки не мешают совпадению', () => {
    expect(normalizeName('Плёнка   ПВХ, 3мм')).toBe(normalizeName('пленка пвх 3 мм'))
  })

  it('видит услуги в строке BOM', () => {
    expect(isServiceLine('Монтаж')).toBe(true)
    expect(isServiceLine('Стекло 6 мм')).toBe(false)
  })

  it('подсказывает похожие позиции для непривязанных строк', () => {
    const s = suggestMatches('Петля стена стекло хром', [glass, hinge])
    expect(s[0].id).toBe(2)
  })
})
