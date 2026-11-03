import { describe, it, expect } from 'vitest'
import { itemName } from '@/lib/b2b/invoiceMath'
import { materialKind, materialLabel, materialLabelShort, materialWithKind, specLacksKind } from '@/lib/materialLabel'

describe('materialLabel — зеркало не должно выглядеть как стекло', () => {
  it('подписывает зеркало, когда в названии этого не видно', () => {
    // Реальный кейс: заказ 5094, материал id 49 «Осветлённое» категории зеркало.
    // В справочнике рядом живёт «Осветлённое CrystalVision» — стекло.
    expect(materialLabel({ materialName: 'Осветлённое', category: 'зеркало', thickness: 4 }))
      .toBe('Зеркало осветлённое 4 мм')
  })

  it('не дублирует слово, если оно уже в названии', () => {
    expect(materialLabel({ materialName: 'Зеркало бронза', category: 'зеркало', thickness: 4 }))
      .toBe('Зеркало бронза 4 мм')
  })

  it('стекло подписано стеклом', () => {
    expect(materialLabel({ materialName: 'Осветлённое CrystalVision', category: 'стекло', thickness: 8 }))
      .toBe('Стекло осветлённое CrystalVision 8 мм')
  })

  it('не плодит «Тонированное … тонированное в массе»', () => {
    expect(materialLabel({ materialName: 'МОРУ БРОНЗА тонированное в массе', category: 'тонированное', thickness: 8 }))
      .toBe('Стекло МОРУ БРОНЗА тонированное в массе 8 мм')
  })

  it('рифлёное подписывается, когда название нейтральное', () => {
    expect(materialLabel({ materialName: 'Дельта', category: 'рифленое', thickness: 4 }))
      .toBe('Стекло рифлёное Дельта 4 мм')
  })

  it('изделие производства: толщина уже в названии — не дублируем', () => {
    expect(materialLabel({ materialName: 'Зеркало с подсветкой Осветлённое 4 мм', category: 'изделие', thickness: 4 }))
      .toBe('Зеркало с подсветкой Осветлённое 4 мм')
  })

  it('без толщины — только название', () => {
    expect(materialLabel({ materialName: 'Осветлённое', category: 'зеркало', thickness: 0 }))
      .toBe('Зеркало осветлённое')
  })

  it('пустое название — отдаём категорию, не падаем', () => {
    expect(materialLabel({ materialName: '', category: 'зеркало', thickness: 4 })).toBe('зеркало')
    expect(materialLabel({})).toBe('')
  })

  it('короткий вариант для карточек цеха', () => {
    expect(materialLabelShort({ materialName: 'Осветлённое', category: 'зеркало', thickness: 4 }))
      .toBe('Зеркало осветлённое 4мм')
  })
})

describe('стекло или зеркало в документах', () => {
  it('одно и то же название различается по категории', () => {
    expect(materialWithKind({ materialName: 'Тонированное (бронза/графит)', category: 'тонированное' })).toBe('Стекло тонированное (бронза/графит)')
    expect(materialWithKind({ materialName: 'Тонированное (бронза/графит)', category: 'зеркало' })).toBe('Зеркало тонированное (бронза/графит)')
    expect(materialWithKind({ materialName: 'KATHEDRAL MAX CL', category: 'стекло' })).toBe('Стекло KATHEDRAL MAX CL')
  })

  it('названия из справочника на проде читаются', () => {
    const cases: [string, string, string][] = [
      ['Прозрачное М1', 'стекло', 'Стекло прозрачное М1'],
      ['Огнеупорное', 'стекло', 'Стекло огнеупорное'],
      ['Lumilac ® (ЛЮМИЛАК) 4 мм', 'стекло', 'Стекло Lumilac ® (ЛЮМИЛАК) 4 мм'],
      ['Мору Crystal Clear', 'рифленое', 'Стекло Мору Crystal Clear'],
      ['Рифленое MORU графит', 'рифленое', 'Стекло рифленое MORU графит'],
      ['KATHEDRAL MAX CL', 'рифленое', 'Стекло KATHEDRAL MAX CL'],
      ['Сатинированное бесцветное', 'сатин', 'Стекло сатинированное бесцветное'],
      ['КОМФОРТ БРОНЗА', 'тонированное', 'Стекло КОМФОРТ БРОНЗА'],
      ['Antique Mirror A-1', 'зеркало', 'Зеркало Antique Mirror A-1'],
      ['Серебро', 'зеркало', 'Зеркало Серебро'],
      ['Зеркало Siver', 'зеркало', 'Зеркало Siver'],
      ['Зеркало тонированное (бронза/графит)', 'зеркало', 'Зеркало тонированное (бронза/графит)'],
    ]
    for (const [materialName, category, want] of cases) expect(materialWithKind({ materialName, category })).toBe(want)
  })

  it('готовое изделие и неизвестная категория без приставки', () => {
    expect(materialWithKind({ materialName: 'Лофт-дверь распашная', category: 'изделие' })).toBe('Лофт-дверь распашная')
    expect(materialKind({ materialName: 'Лофт-дверь', category: 'изделие' })).toBeNull()
  })

  it('без категории решает название', () => {
    expect(materialKind({ materialName: 'Antique Mirror' })).toBe('Зеркало')
    expect(materialWithKind({ materialName: 'Прозрачное' })).toBe('Стекло прозрачное')
  })

  it('нет названия: вид по категории, иначе запасное значение', () => {
    expect(materialWithKind({ materialName: '', category: 'зеркало' }, 'Стекло')).toBe('Зеркало')
    expect(materialWithKind({ materialName: null }, 'Стекло')).toBe('Стекло')
    expect(materialWithKind({})).toBe('')
  })

  it('свободный текст договора: строка без слова видна, услуги не трогаем', () => {
    expect(specLacksKind({ name: 'Душевая кабина', desc: '' })).toBe(true)
    expect(specLacksKind({ name: 'Душевая кабина', desc: 'закалённое стекло 8 мм' })).toBe(false)
    expect(specLacksKind({ name: 'Зеркало с подсветкой' })).toBe(false)
    expect(specLacksKind({ name: 'Монтаж' })).toBe(false)
    expect(specLacksKind({ name: 'Доставка по Москве' })).toBe(false)
    expect(specLacksKind({ name: '', desc: '' })).toBe(false)
  })

  it('строка счёта и УПД: случай из счёта 05843', () => {
    expect(itemName({ materialName: 'Тонированное (бронза/графит)', category: 'тонированное', thickness: 8, hasTempering: true, width: 995, height: 2196 }))
      .toBe('Стекло тонированное (бронза/графит), 8 мм, закалённое, 995×2196 мм')
  })
})
