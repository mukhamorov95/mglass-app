import { describe, it, expect } from 'vitest'
import { canonicalOrderIds, orderSetKey, sameOrderSet } from '@/lib/b2b/invoiceRegistry'

describe('канонизация набора заказов', () => {
  it('сортирует, дедупит, отбрасывает мусор', () => {
    expect(canonicalOrderIds([3, 1, 2, 1])).toEqual([1, 2, 3])
    expect(canonicalOrderIds(['5', 5, 0, -1, 'x', null])).toEqual([5])
    expect(canonicalOrderIds(null)).toEqual([])
  })

  it('ключ не зависит от порядка выбора и повторов', () => {
    expect(orderSetKey([2, 1])).toBe('1,2')
    expect(orderSetKey([1, 2, 2, 1])).toBe('1,2')
  })

  it('sameOrderSet различает набор из одного и из нескольких заказов', () => {
    expect(sameOrderSet([7], [7])).toBe(true)
    expect(sameOrderSet([1, 2], [2, 1])).toBe(true)
    // счёт на 2 заказа НЕ равен счёту на 1 из них — иначе платёж уйдёт не туда
    expect(sameOrderSet([1, 2], [1])).toBe(false)
    expect(sameOrderSet([1], [2])).toBe(false)
  })
})
