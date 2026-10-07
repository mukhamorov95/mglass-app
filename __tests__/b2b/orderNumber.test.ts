import { describe, it, expect } from 'vitest'
import { maxFormattedNumber, nextOrderNumber } from '@/lib/b2b/orderNumber'

describe('номер заказа', () => {
  it('максимум только по номерам вида NNNN-КК, ведущие нули не мешают', () => {
    expect(maxFormattedNumber(['0887-2', '1939-01', '05656', null, ' 1940-3 ', 'abc-1'])).toBe(1940)
    expect(maxFormattedNumber(['05656', null])).toBeNull()
  })
  it('следующий — максимум + 1 и код менеджера двумя цифрами', () => {
    expect(nextOrderNumber(1940, 2)).toBe('1941-02')
    expect(nextOrderNumber(1940, 12)).toBe('1941-12')
  })
})
