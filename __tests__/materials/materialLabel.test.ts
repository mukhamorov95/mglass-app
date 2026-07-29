import { describe, it, expect } from 'vitest'
import { materialLabel, materialLabelShort } from '@/lib/materialLabel'

describe('materialLabel — зеркало не должно выглядеть как стекло', () => {
  it('подписывает зеркало, когда в названии этого не видно', () => {
    // Реальный кейс: заказ 5094, материал id 49 «Осветлённое» категории зеркало.
    // В справочнике рядом живёт «Осветлённое CrystalVision» — стекло.
    expect(materialLabel({ materialName: 'Осветлённое', category: 'зеркало', thickness: 4 }))
      .toBe('Зеркало Осветлённое 4 мм')
  })

  it('не дублирует слово, если оно уже в названии', () => {
    expect(materialLabel({ materialName: 'Зеркало бронза', category: 'зеркало', thickness: 4 }))
      .toBe('Зеркало бронза 4 мм')
  })

  it('стекло не получает лишнего префикса', () => {
    expect(materialLabel({ materialName: 'Осветлённое CrystalVision', category: 'стекло', thickness: 8 }))
      .toBe('Осветлённое CrystalVision 8 мм')
  })

  it('не плодит «Тонированное … тонированное в массе»', () => {
    expect(materialLabel({ materialName: 'МОРУ БРОНЗА тонированное в массе', category: 'тонированное', thickness: 8 }))
      .toBe('МОРУ БРОНЗА тонированное в массе 8 мм')
  })

  it('рифлёное подписывается, когда название нейтральное', () => {
    expect(materialLabel({ materialName: 'Дельта', category: 'рифленое', thickness: 4 }))
      .toBe('Рифлёное Дельта 4 мм')
  })

  it('изделие производства: толщина уже в названии — не дублируем', () => {
    expect(materialLabel({ materialName: 'Зеркало с подсветкой Осветлённое 4 мм', category: 'изделие', thickness: 4 }))
      .toBe('Зеркало с подсветкой Осветлённое 4 мм')
  })

  it('без толщины — только название', () => {
    expect(materialLabel({ materialName: 'Осветлённое', category: 'зеркало', thickness: 0 }))
      .toBe('Зеркало Осветлённое')
  })

  it('пустое название — отдаём категорию, не падаем', () => {
    expect(materialLabel({ materialName: '', category: 'зеркало', thickness: 4 })).toBe('зеркало')
    expect(materialLabel({})).toBe('')
  })

  it('короткий вариант для карточек цеха', () => {
    expect(materialLabelShort({ materialName: 'Осветлённое', category: 'зеркало', thickness: 4 }))
      .toBe('Зеркало Осветлённое 4мм')
  })
})
