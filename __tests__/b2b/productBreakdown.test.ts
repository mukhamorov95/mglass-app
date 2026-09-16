import { describe, it, expect } from 'vitest'
import { parseProductSpec, reconcile } from '@/lib/b2b/productBreakdown'

// Комплектация из реального заказа 0868-2 (#5475)
const COMMENT = '700×1200 мм · криволинейное · подложка подрядчика 1 500 ₽ · лента: EL-24V-96N 24V · БП EL-LB2472 · сенсорная кнопка'

describe('разбор комплектации изделия', () => {
  it('зеркало с подсветкой из заказа 0868-2', () => {
    const s = parseProductSpec('Зеркало с подсветкой Осветлённое 4 мм', COMMENT, 4)
    expect(s).toEqual({
      mirrorName: 'Осветлённое', mirrorMm: 4, hasLighting: true, metalFrame: false,
      curved: true, underlayCost: 1500, ledShort: 'EL-24V-96N', frameShort: null,
      psuShort: 'EL-LB2472', buttonType: 'sensor',
    })
  })

  it('прямоугольное с каркасом и датчиком взмаха', () => {
    const s = parseProductSpec('Зеркало с подсветкой Бронза 4 мм',
      '600×800 мм · лента: EL-12V-60 3000K 12V · каркас: ПР-15 · БП EL-LB1236 · датчик взмаха', 4)
    expect(s?.curved).toBe(false)
    expect(s?.frameShort).toBe('ПР-15')
    expect(s?.ledShort).toBe('EL-12V-60')
    expect(s?.buttonType).toBe('wave')
    expect(s?.underlayCost).toBe(0)
  })

  it('металлическая рама и зеркало без подсветки', () => {
    const s = parseProductSpec('Зеркало в металлической раме Осветлённое 6 мм', '900×1800 мм', 6)
    expect(s?.metalFrame).toBe(true)
    expect(s?.hasLighting).toBe(false)
    expect(s?.mirrorName).toBe('Осветлённое')
  })

  it('не зеркало — разбора нет', () => {
    expect(parseProductSpec('Лофт-перегородка 2 створки', '2000×2100 мм', 8)).toBeNull()
  })
})

describe('сверка состава с сохранённой суммой', () => {
  const lines = [
    { name: 'Зеркало Осветлённое', qty: 1.1, unit: 'м²', price: 2000, total: 2200 },
    { name: 'Лента EL-24V-96N', qty: 3.8, unit: 'пог.м', price: 300, total: 1140 },
    { name: 'Подложка', qty: 1, unit: 'шт', price: 1500, total: 1500 },
  ]

  it('сумма строк совпала с сохранённой — состав можно показывать как есть', () => {
    const r = reconcile(lines, 4840, 'recalc')
    expect(r.sum).toBe(4840)
    expect(r.reconciles).toBe(true)
  })

  it('рубль округления — всё ещё сходится', () => {
    expect(reconcile(lines, 4841, 'recalc').reconciles).toBe(true)
  })

  it('цены справочника изменились — расхождение видно', () => {
    const r = reconcile(lines, 5200, 'recalc')
    expect(r.reconciles).toBe(false)
    expect(r.stored).toBe(5200)
  })
})
