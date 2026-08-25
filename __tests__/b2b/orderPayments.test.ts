import { describe, it, expect } from 'vitest'
import { paidByOrder, remainderStatus, type PaymentRow, type InvoiceRow } from '@/lib/b2b/orderPayments'

const P = (o: Partial<PaymentRow>): PaymentRow => ({ amount: 0, b2b_order_id: null, invoice_id: null, voided_at: null, ...o })

describe('paidByOrder', () => {
  it('прямые платежи по заказу суммируются, войднутые игнорируются', () => {
    const paid = paidByOrder(
      [P({ amount: 30000, b2b_order_id: 1 }), P({ amount: 20000, b2b_order_id: 1 }), P({ amount: 99999, b2b_order_id: 1, voided_at: '2026-08-01' })],
      [], new Map(),
    )
    expect(paid.get(1)).toBe(50000)
  })

  it('платёж по мульти-заказному счёту раскладывается пропорционально суммам', () => {
    const invoices: InvoiceRow[] = [{ id: 7, order_ids: [1, 2], amount: 100000 }]
    const totals = new Map([[1, 80000], [2, 20000]])
    const paid = paidByOrder([P({ amount: 50000, invoice_id: 7 })], invoices, totals)
    expect(paid.get(1)).toBe(40000)  // 80% доли
    expect(paid.get(2)).toBe(10000)  // 20%
  })

  it('счёт без известных сумм заказов — делит поровну, деньги не теряются', () => {
    const invoices: InvoiceRow[] = [{ id: 7, order_ids: [1, 2], amount: 0 }]
    const paid = paidByOrder([P({ amount: 30000, invoice_id: 7 })], invoices, new Map())
    expect(paid.get(1)).toBe(15000)
    expect(paid.get(2)).toBe(15000)
  })
})

describe('remainderStatus — молчание при отсутствии данных', () => {
  it('ноль платежей = нет данных, НЕ долг', () => {
    const s = remainderStatus(100000, 0)
    expect(s.hasPayment).toBe(false)
    expect(s.outstanding).toBe(false)   // главное: не кричим «долг» на неоплаченном
  })

  it('частичная оплата = реальный остаток', () => {
    const s = remainderStatus(100000, 40000)
    expect(s.outstanding).toBe(true)
    expect(s.remainder).toBe(60000)
  })

  it('полная оплата — остатка нет', () => {
    expect(remainderStatus(100000, 100000).outstanding).toBe(false)
    expect(remainderStatus(100000, 105000).overpaid).toBe(true)
  })

  it('копеечный хвост от раскладки не считается долгом', () => {
    expect(remainderStatus(100000, 99999.6).outstanding).toBe(false)
  })
})
