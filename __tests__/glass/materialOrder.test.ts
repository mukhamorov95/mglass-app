import { describe, it, expect } from 'vitest'
import { applyDraft, moveName, orderedNames, rankMap, sameOrder, sortByDirectory } from '@/lib/glass/materialOrder'

// Как в базе 21.10: у двух продажных строк sort_order 0 — они всплывали наверх справочника.
const rows = [
  { name: 'Прозрачное М1', category: 'glass', price_type: 'cost', sort_order: 1 },
  { name: 'Прозрачное М1', category: 'glass', price_type: 'sale', sort_order: 1 },
  { name: 'Тонированное (бронза/графит)', category: 'glass', price_type: 'cost', sort_order: 2 },
  { name: 'Flutelite - S 4мм (осветленное)', category: 'glass', price_type: 'cost', sort_order: 10 },
  { name: 'Flutelite - S 4мм (осветленное)', category: 'glass', price_type: 'sale', sort_order: 0 },
  { name: 'Тонированное (бронза/графит)', category: 'mirror', price_type: 'cost', sort_order: 3 },
  { name: 'Серебро', category: 'mirror', price_type: 'cost', sort_order: 1 },
]

describe('порядок материалов справочника', () => {
  it('место — по строке себестоимости, продажный 0 не поднимает материал наверх', () => {
    expect(orderedNames(rows, 'glass')).toEqual(['Прозрачное М1', 'Тонированное (бронза/графит)', 'Flutelite - S 4мм (осветленное)'])
    expect(orderedNames(rows, 'mirror')).toEqual(['Серебро', 'Тонированное (бронза/графит)'])
  })
  it('одно имя в стекле и в зеркале — разные места', () => {
    const r = rankMap(rows)
    expect(r.get('glass|Тонированное (бронза/графит)')).toBe(2)
    expect(r.get('mirror|Тонированное (бронза/графит)')).toBe(3)
  })
  it('стрелки двигают на одно место, на краю — ничего', () => {
    const base = orderedNames(rows, 'glass')
    expect(moveName(base, 'Flutelite - S 4мм (осветленное)', -1)).toEqual(['Прозрачное М1', 'Flutelite - S 4мм (осветленное)', 'Тонированное (бронза/графит)'])
    expect(moveName(base, 'Прозрачное М1', -1)).toBe(base)
  })
  it('черновик поверх базы: удалённое выпадает, новое — в конец', () => {
    expect(applyDraft(['a', 'b', 'c'], ['c', 'x', 'a'])).toEqual(['c', 'a', 'b'])
    expect(sameOrder(applyDraft(['a', 'b'], undefined), ['a', 'b'])).toBe(true)
  })
  it('калькулятор: по месту справочника, без места — в конце по алфавиту', () => {
    const mats = [{ name: 'Я' }, { name: 'Б', sort_rank: 2 }, { name: 'А' }, { name: 'В', sort_rank: 1 }]
    expect(sortByDirectory(mats).map(m => m.name)).toEqual(['В', 'Б', 'А', 'Я'])
  })
})
