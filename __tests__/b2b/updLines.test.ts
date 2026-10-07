import { describe, it, expect } from 'vitest'
import { updDocDate, updLines, updVatRate } from '@/lib/b2b/updLines'
import { computeInvoiceTotals, type InvoiceOrder } from '@/lib/b2b/invoiceMath'

const order: InvoiceOrder = {
  id: 5481, custom_number: '05481', discount_percent: 10, notes: null, created_at: '2026-09-10T10:00:00Z',
  total_sale_inc_vat: 30_000, total_after_discount: 27_000,
  items: [
    { materialName: 'Зеркало', thickness: 4, quantity: 3, saleIncVat: 10_000 },
    { materialName: 'Стекло', thickness: 8, quantity: 7, saleIncVat: 20_000, hasTempering: true },
  ],
}

describe('строки УПД', () => {
  it('цена за единицу и стоимость — без НДС, НДС по строке, итоги — суммы строк', () => {
    const { lines, totals } = updLines(order, '2026-10-05')
    expect(lines[0]).toEqual({ qty: 3, priceNoVat: 2459.02, sumNoVat: 7377.05, vatRate: 22, vat: 1622.95, sumIncVat: 9000 })
    expect(lines[1].sumIncVat).toBe(18000)
    for (const l of lines) expect(Math.round((l.sumNoVat + l.vat) * 100) / 100).toBe(l.sumIncVat)
    expect(totals.sumIncVat).toBe(27000)
    expect(totals.vat).toBe(Math.round((lines[0].vat + lines[1].vat) * 100) / 100)
    expect(Math.round((totals.sumNoVat + totals.vat) * 100) / 100).toBe(totals.sumIncVat)
  })

  it('итог с НДС сходится со счётом до копейки и при договорной сумме', () => {
    const odd = { ...order, total_after_discount: 26_999.99 }
    expect(updLines(odd, '2026-10-05').totals.sumIncVat).toBe(computeInvoiceTotals(odd).totalPay)
  })

  it('ставка по дате отгрузки: до 2026 — 20 %', () => {
    expect(updVatRate('2025-12-31')).toBe(20)
    expect(updVatRate('2026-01-01T00:00:00Z')).toBe(22)
    expect(updLines(order, '2025-12-20').lines[0].vat).toBe(1500)
  })
})

describe('дата УПД', () => {
  it('отметка «Отгружен» важнее даты запуска', () => {
    expect(updDocDate({ launched_at: '2026-09-17', stages: { shipped: '2026-10-05' } }, '2026-09-10')).toEqual({ date: '2026-10-05', source: 'shipped' })
  })
  it('без отметки — shipped_date, затем запуск, затем просчёт', () => {
    expect(updDocDate({ shipped_date: '2026-10-01', launched_at: '2026-09-17' }, 'x').source).toBe('shipped')
    expect(updDocDate({ launched_at: '2026-09-17' }, 'x')).toEqual({ date: '2026-09-17', source: 'launched' })
    expect(updDocDate({}, '2026-09-10')).toEqual({ date: '2026-09-10', source: 'created' })
  })
})

describe('счёт: цена из прайса клиента', () => {
  it('скидка заказа не применяется к строке с clientPriced', () => {
    const o: InvoiceOrder = { ...order, total_after_discount: 0, total_sale_inc_vat: 0, items: [
      { quantity: 1, saleIncVat: 10_000, clientPriced: true },
      { quantity: 1, saleIncVat: 20_000 },
    ] }
    const t = computeInvoiceTotals({ ...o, total_sale_inc_vat: 30_000, total_after_discount: 28_000 })
    expect(t.lineSums).toEqual([10_000, 18_000])
  })
})
