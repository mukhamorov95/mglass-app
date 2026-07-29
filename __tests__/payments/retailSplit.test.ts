import { describe, it, expect } from 'vitest'
import { orderPaymentKey, salePaymentKey } from '@/lib/payments/paymentKeys'

// Розничный заказ: статус оплаты раскладывается на строки payments.
// Логика разбиения повторяет app/api/orders/[id]/payment/route.ts — держим её
// под тестом, потому что ошибка здесь = неверная выручка в Отделе продаж.
function splitRetail(status: string, total: number, prepay: number) {
  if (status === 'unpaid') return []
  if (status === 'partial') return prepay > 0 ? [{ kind: 'prepayment', amount: prepay }] : []
  const rest = Math.round((total - prepay) * 100) / 100
  const rows: { kind: string; amount: number }[] = []
  if (prepay > 0) rows.push({ kind: 'prepayment', amount: prepay })
  if (rest > 0) rows.push({ kind: prepay > 0 ? 'remainder' : 'full', amount: rest })
  return rows
}

describe('розничная оплата → строки платежей', () => {
  it('оплачен без предоплаты — одна строка на всю сумму', () => {
    expect(splitRetail('paid', 100000, 0)).toEqual([{ kind: 'full', amount: 100000 }])
  })

  it('оплачен с предоплатой — предоплата + остаток, в сумме ровно заказ', () => {
    const rows = splitRetail('paid', 100000, 30000)
    expect(rows).toEqual([
      { kind: 'prepayment', amount: 30000 },
      { kind: 'remainder', amount: 70000 },
    ])
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(100000)
  })

  it('частично — только предоплата, остаток не пишем', () => {
    expect(splitRetail('partial', 100000, 30000)).toEqual([{ kind: 'prepayment', amount: 30000 }])
  })

  it('частично без суммы предоплаты — ничего не пишем', () => {
    expect(splitRetail('partial', 100000, 0)).toEqual([])
  })

  it('не оплачен — платежей нет', () => {
    expect(splitRetail('unpaid', 100000, 30000)).toEqual([])
  })

  it('предоплата равна сумме заказа — остатка нет, дубля нет', () => {
    const rows = splitRetail('paid', 50000, 50000)
    expect(rows).toEqual([{ kind: 'prepayment', amount: 50000 }])
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(50000)
  })

  it('копейки не теряются', () => {
    const rows = splitRetail('paid', 12345.67, 5000.5)
    expect(rows[1].amount).toBe(7345.17)
    expect(Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100).toBe(12345.67)
  })
})

describe('ключи платежей: розница и ведомость дают ОДНУ строку, не дубль', () => {
  const uuid = '11111111-2222-3333-4444-555555555555'

  it('отметка в заказе и в ведомости продаж — один и тот же ключ', () => {
    const fromOrder = orderPaymentKey(uuid, 'prepayment')
    const fromSale  = salePaymentKey({ id: 7, order_id: uuid, b2b_order_id: null }, 'prepayment')
    expect(fromSale).toBe(fromOrder)
  })

  it('остаток тоже канонизируется по заказу', () => {
    expect(salePaymentKey({ id: 7, order_id: uuid, b2b_order_id: null }, 'remainder'))
      .toBe(orderPaymentKey(uuid, 'settlement'))
  })

  it('продажа без заказа — собственный ключ, чужие не задевает', () => {
    expect(salePaymentKey({ id: 7, order_id: null, b2b_order_id: null }, 'prepayment')).toBe('sale:7:prepayment')
  })
})
