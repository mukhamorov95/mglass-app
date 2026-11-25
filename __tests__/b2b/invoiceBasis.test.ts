import { describe, expect, it } from 'vitest'
import { invoiceBasis, paymentPurpose, PURPOSE_MAX } from '@/lib/b2b/invoiceMath'
import { invoiceNoIn } from '@/lib/accounting/bankMatch'
import { paymentQrStringFor } from '@/lib/paymentQr'
import { SELLER_B2B } from '@/lib/companyRequisites'

describe('invoiceBasis — основание объединённого счёта', () => {
  it('перечисляет наши номера, их номер — в скобках, если есть', () => {
    expect(invoiceBasis([{ no: '05988', theirNo: '1201' }, { no: '05986', theirNo: null }]))
      .toBe('Оплата заказов № 05988 (ваш № 1201), № 05986')
  })
  it('один заказ — единственное число; пусто — нет строки', () => {
    expect(invoiceBasis([{ no: '05970' }])).toBe('Оплата заказа № 05970')
    expect(invoiceBasis([])).toBeNull()
  })
})

describe('paymentPurpose — назначение платежа в QR', () => {
  const nos = Array.from({ length: 28 }, (_, i) => `0${5867 + i}`)
  it('на 28 заказах номер счёта переживает обрезку и находится выпиской', () => {
    const p = paymentPurpose('05867–05965', nos)
    expect(p.length).toBeLessThanOrEqual(PURPOSE_MAX)
    expect(p).toMatch(/и ещё \d+$/)
    const qr = paymentQrStringFor(SELLER_B2B, 100, p)
    expect(qr).toContain(p)
    expect(invoiceNoIn('05867–05965', qr.split('Purpose=')[1])).toBe(true)
  })
  it('короткий список — целиком; без заказов — только счёт', () => {
    expect(paymentPurpose('05986–05988', ['05986', '05988'])).toBe('Оплата по счёту-спецификации № 05986–05988. Заказы № 05986, 05988')
    expect(paymentPurpose('05970')).toBe('Оплата по счёту-спецификации № 05970')
  })
})
