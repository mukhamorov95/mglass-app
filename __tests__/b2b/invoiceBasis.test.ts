import { describe, expect, it } from 'vitest'
import { invoiceBasis } from '@/lib/b2b/invoiceMath'

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
