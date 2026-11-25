import { describe, expect, it } from 'vitest'
import { combinedInvoiceNo, planCombined, type RelatedInvoice } from '@/lib/partner/combinedInvoice'
import { computeInvoiceTotals, mergeInvoiceOrders } from '@/lib/b2b/invoiceMath'

const inv = (id: number, order_ids: number[], derivedStatus: RelatedInvoice['derivedStatus'] = 'unpaid'): RelatedInvoice =>
  ({ id, invoice_no: String(id), order_ids, status: 'issued', derivedStatus })

describe('объединённый счёт кабинета', () => {
  it('номер — диапазон номеров заказов', () => {
    expect(combinedInvoiceNo(['05576', '05553', '05560'])).toBe('05553–05576')
  })
  it('неоплаченный одиночный счёт заменяется, оплаченный и чужой набор — стоп', () => {
    const p = planCombined([1, 2, 3], [inv(10, [1]), inv(11, [2], 'partial'), inv(12, [3, 9])])
    expect(p.replace.map(r => r.id)).toEqual([10])
    expect(p.blocked.map(b => [b.invoice.id, b.reason])).toEqual([[11, 'paid'], [12, 'outside']])
  })
  it('тот же набор — тот же счёт', () => {
    expect(planCombined([2, 1], [inv(20, [1, 2])]).same?.id).toBe(20)
  })
  it('итог объединённого счёта = сумма итогов заказов, скидки заказов учтены', () => {
    const a = { id: 1, no: '00001', custom_number: null, discount_percent: 10, items: [{ saleIncVat: 333.33, quantity: 1 }, { saleIncVat: 100, quantity: 2 }], total_sale_inc_vat: 433.33, total_after_discount: 390, notes: null, created_at: '2026-11-01' }
    const b = { id: 2, no: '00002', custom_number: null, discount_percent: 0, items: [{ saleIncVat: 1000.01, quantity: 1 }], total_sale_inc_vat: 1000.01, total_after_discount: 1000.01, notes: null, created_at: '2026-11-02' }
    const m = mergeInvoiceOrders([a, b], { id: 7, invoiceNo: '00001–00002', issuedAt: '2026-11-25' })
    const t = computeInvoiceTotals(m)
    expect(t.totalPay).toBe(1390.01)
    expect(Math.round(t.lineSums.reduce((s, x) => s + x, 0) * 100) / 100).toBe(1390.01)
    expect(m.items[0].comment).toBe('заказ 00001')
    expect(m.items).toHaveLength(3)
  })
})
