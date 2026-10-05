import { describe, it, expect } from 'vitest'
import { bookNames } from '@/lib/sales/bookNames'

describe('bookNames — имя сотрудника, как в книгах владельца', () => {
  it('учётка «Семен» находит строки «Семён»', () => {
    expect(bookNames('Семен')).toEqual(['Семен', 'Семён'])
    expect(bookNames('Семён')).toEqual(['Семён', 'Семен'])
  })

  it('учётка «Дмитрий» находит строки «Дима»', () => {
    expect(bookNames('Дмитрий')).toEqual(['Дмитрий', 'Дима'])
  })

  it('учётка владельца находит строки «Влад»', () => {
    expect(bookNames('Администратор')).toEqual(['Администратор', 'Влад'])
  })

  it('совпадающее имя остаётся одним', () => {
    expect(bookNames('Яна')).toEqual(['Яна'])
    expect(bookNames(' Александра ')).toEqual(['Александра'])
  })

  it('пустое имя ничего не находит, а не находит всё', () => {
    expect(bookNames('')).toEqual([])
    expect(bookNames('  ')).toEqual([])
  })
})
