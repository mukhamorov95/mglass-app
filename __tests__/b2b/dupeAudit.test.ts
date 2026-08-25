import { describe, it, expect } from 'vitest'
import { materialDupes, serviceDupes, normalizeName, type MaterialRow } from '@/lib/b2b/dupeAudit'

// Боевой случай: «Тонированное (бронза/графит)» 4 мм заведено дважды с разной
// категорией и ценой (зеркало 1000₽ / тонированное 695₽), обе активны.
const REAL: MaterialRow[] = [
  { id: 16, name: 'Тонированное (бронза/графит)', category: 'зеркало',      thickness: 4, cost_price: 1000, waste_percent: 18, active: true,  uses: 21 },
  { id: 70, name: 'Тонированное (бронза/графит)', category: 'тонированное', thickness: 4, cost_price: 695,  waste_percent: 30, active: true,  uses: 5 },
  { id: 18, name: 'Тонированное (бронза/графит)', category: 'зеркало',      thickness: 6, cost_price: 1700, waste_percent: 18, active: true,  uses: 1 },
  { id: 71, name: 'Тонированное (бронза/графит)', category: 'тонированное', thickness: 6, cost_price: 1056, waste_percent: 30, active: true,  uses: 13 },
  { id: 99, name: 'Прозрачное М1',                category: 'стекло',       thickness: 4, cost_price: 500,  waste_percent: 30, active: true,  uses: 40 },
]

describe('materialDupes', () => {
  it('ловит дубль с разной категорией — категория не должна прятать расхождение', () => {
    const groups = materialDupes(REAL)
    expect(groups).toHaveLength(2)  // 4мм и 6мм; уникальный «Прозрачное М1» не группа
    const four = groups.find(g => g.key.includes('|4'))!
    expect(four.variants.map(v => v.row.id).sort()).toEqual([16, 70])
    expect(four.categoriesDiffer).toBe(true)
    expect(four.costConflict).toBe(true)
    expect(four.costDeltaRub).toBe(305)
    expect(four.costDeltaPct).toBe(44)
  })

  it('«цена вопроса» = расхождение ₽ × использование', () => {
    const four = materialDupes(REAL).find(g => g.key.includes('|4'))!
    expect(four.totalUses).toBe(26)
    expect(four.priceOfQuestion).toBe(305 * 26)  // 7930
    const six = materialDupes(REAL).find(g => g.key.includes('|6'))!
    expect(six.priceOfQuestion).toBe(644 * 14)   // 9016
  })

  it('сортирует по «цене вопроса»: 6мм (9016) выше 4мм (7930)', () => {
    const groups = materialDupes(REAL)
    expect(groups[0].key).toContain('|6')
    expect(groups[1].key).toContain('|4')
  })

  it('конфликт активных строк приоритетнее спящего дубля', () => {
    const rows: MaterialRow[] = [
      { id: 1, name: 'A', category: 'стекло', thickness: 4, cost_price: 100, waste_percent: 30, active: true,  uses: 1 },
      { id: 2, name: 'A', category: 'стекло', thickness: 4, cost_price: 100, waste_percent: 30, active: false, uses: 0 }, // спящий, та же цена
      { id: 3, name: 'B', category: 'стекло', thickness: 6, cost_price: 200, waste_percent: 30, active: true,  uses: 2 },
      { id: 4, name: 'B', category: 'стекло', thickness: 6, cost_price: 260, waste_percent: 30, active: true,  uses: 2 }, // конфликт
    ]
    const groups = materialDupes(rows)
    expect(groups[0].label.startsWith('B')).toBe(true)
    expect(groups[0].costConflict).toBe(true)
    expect(groups[1].costConflict).toBe(false)
  })

  it('уникальные материалы группами не становятся', () => {
    const uniq: MaterialRow[] = [{ id: 1, name: 'Уник', category: 'стекло', thickness: 4, cost_price: 500, waste_percent: 30, active: true, uses: 3 }]
    expect(materialDupes(uniq)).toEqual([])
  })
})

describe('normalizeName', () => {
  it('схлопывает регистр и пробелы, но не отрезает слова', () => {
    expect(normalizeName('  Тонированное   (Бронза/Графит) ')).toBe('тонированное (бронза/графит)')
    expect(normalizeName('Зеркало тонированное')).not.toBe(normalizeName('тонированное'))
  })
})

describe('serviceDupes', () => {
  it('группирует услуги по имени+типу', () => {
    const groups = serviceDupes([
      { id: 4,  name: 'Матовка под сенсорную кнопку', type: 'fixed', cost_price: 0, active: true,  uses: 3 },
      { id: 12, name: 'Матовка под сенсорную кнопку', type: 'fixed', cost_price: 0, active: false, uses: 0 },
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].costConflict).toBe(false)  // одна активная, цены равны
  })
})
