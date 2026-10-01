import { describe, it, expect } from 'vitest'
import { periodFilter, searchFilters, searchWords } from '@/lib/measure/search'

describe('поиск замера', () => {
  it('слова: знаки препинания режут, дефис в номере заказа остаётся, короткие выбрасываем', () => {
    expect(searchWords('ул. Булатниковская, 9к1')).toEqual(['ул', 'Булатниковская', '9к1'])
    expect(searchWords('0171-0')).toEqual(['0171-0'])
    expect(searchWords(' a , ,')).toEqual([])
  })

  it('цифры — телефон с любыми знаками между цифрами, номер заказа и адрес', () => {
    expect(searchFilters('4186972')).toEqual(['phone.ilike.*4*1*8*6*9*7*2*,deal_number.ilike.*4186972*,address.ilike.*4186972*'])
  })

  it('текст — во всех полях; каждое слово отдельным фильтром (И)', () => {
    const f = searchFilters('Welton 138')
    expect(f).toHaveLength(2)
    expect(f[0]).toBe('address.ilike.*Welton*,client_name.ilike.*Welton*,deal_number.ilike.*Welton*,scope.ilike.*Welton*,notes.ilike.*Welton*,phone.ilike.*Welton*')
    expect(f[1]).toContain('address.ilike.*138*') // 3 цифры — не телефон, ищем как текст
  })

  it('в фильтр не попадают символы, ломающие синтаксис or(): запятые, скобки, звёздочки', () => {
    for (const s of searchFilters('a,(b)*c, 12,34')) expect(s).not.toMatch(/[()]/)
  })

  it('период — по дате замера, у заявок без времени по дате создания, МСК включительно', () => {
    expect(periodFilter('2026-10-01', '2026-10-31')).toBe(
      'and(scheduled_at.gte."2026-09-30T21:00:00.000Z",scheduled_at.lt."2026-10-31T21:00:00.000Z"),' +
      'and(scheduled_at.is.null,created_at.gte."2026-09-30T21:00:00.000Z",created_at.lt."2026-10-31T21:00:00.000Z")')
  })
})
