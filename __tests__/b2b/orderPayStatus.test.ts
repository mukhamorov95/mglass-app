import { describe, it, expect } from 'vitest'
import { payStatusFromPayments } from '@/lib/b2b/orderPayStatus'

describe('оплата заказа из платежей', () => {
  it('не загрузилось — неизвестно; платежей нет — не оплачен', () => {
    expect(payStatusFromPayments(10_000, undefined)).toBe('unknown')
    expect(payStatusFromPayments(10_000, 0)).toBe('unpaid')
  })
  it('частично и полностью; рубль округления — оплачен, переплата — оплачен', () => {
    expect(payStatusFromPayments(10_000, 4_000)).toBe('partial')
    expect(payStatusFromPayments(10_000, 9_999)).toBe('paid')
    expect(payStatusFromPayments(10_000, 10_000)).toBe('paid')
    expect(payStatusFromPayments(10_000, 12_000)).toBe('paid')
  })
})
