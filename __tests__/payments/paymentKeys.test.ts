import { describe, it, expect } from 'vitest'
import {
  b2bPaymentKey, orderPaymentKey, salePaymentKey, gsheetPaymentKey,
  buildPaymentRow,
} from '@/lib/payments/paymentKeys'

// Идемпотентность денежного ядра держится на канонических ключах:
// один бизнес-документ → один ключ, из какого бы экрана ни пришла отметка.

describe('канонические ключи платежей', () => {
  it('B2B: предоплата и расчёт — разные ключи одного заказа', () => {
    expect(b2bPaymentKey(4960, 'prepayment')).toBe('b2b:4960:prepayment')
    expect(b2bPaymentKey(4960, 'settlement')).toBe('b2b:4960:settlement')
  })

  it('галочка в ведомости при связанном B2B-заказе даёт ключ ЗАКАЗА (не свой)', () => {
    const sale = { id: 7, b2b_order_id: 4960, order_id: null }
    expect(salePaymentKey(sale, 'prepayment')).toBe('b2b:4960:prepayment')
    expect(salePaymentKey(sale, 'remainder')).toBe('b2b:4960:settlement')
  })

  it('галочка при связанном розничном заказе даёт ключ розницы', () => {
    const sale = { id: 7, order_id: 'abc-123', b2b_order_id: null }
    expect(salePaymentKey(sale, 'remainder')).toBe('order:abc-123:settlement')
    expect(orderPaymentKey('abc-123', 'settlement')).toBe('order:abc-123:settlement')
  })

  it('продажа без внутреннего заказа (сделка AmoCRM) — собственный ключ', () => {
    const sale = { id: 7 }
    expect(salePaymentKey(sale, 'prepayment')).toBe('sale:7:prepayment')
    expect(salePaymentKey(sale, 'remainder')).toBe('sale:7:remainder')
  })

  it('импорт из Google: ключ по номеру заказа, пробелы срезаются', () => {
    expect(gsheetPaymentKey(' 0157 ')).toBe('gsheet:0157')
  })
})

describe('buildPaymentRow', () => {
  const base = { externalKey: 'b2b:1:settlement', amount: 100_000, paidAt: '2026-07-20', kind: 'full' as const, source: 'test', b2bOrderId: 1 }

  it('собирает строку с дефолтами и снимает void при повторной отметке', () => {
    const row = buildPaymentRow(base)
    expect(row.method).toBe('Счёт')
    expect(row.voided_at).toBeNull()
    expect(row.amount).toBe(100_000)
  })

  it('копейки округляются до 2 знаков', () => {
    expect(buildPaymentRow({ ...base, amount: 99.999 }).amount).toBe(100)
    expect(buildPaymentRow({ ...base, amount: 0.015 }).amount).toBe(0.02)
  })

  it('отклоняет нулевую/отрицательную сумму', () => {
    expect(() => buildPaymentRow({ ...base, amount: 0 })).toThrow()
    expect(() => buildPaymentRow({ ...base, amount: -5 })).toThrow()
  })

  it('отклоняет платёж без документа и кривую дату', () => {
    expect(() => buildPaymentRow({ ...base, b2bOrderId: undefined })).toThrow(/без документа/)
    expect(() => buildPaymentRow({ ...base, paidAt: '20.07.2026' })).toThrow(/не дата/)
  })
})
