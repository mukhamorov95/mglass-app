import { describe, it, expect } from 'vitest'
import { pointStage, POINT_LINE } from '@/lib/partner/pointPay'
import { markedPaid } from '@/lib/partner/orderMoney'

const base = { isPoint: true, launched: false, submitted: true, invoiced: false, paid: false }

describe('точка платит до запуска — строка заказа', () => {
  it('отправлен, счёта нет — менеджер проверяет сумму', () => {
    expect(pointStage(base)).toBe('check')
  })
  it('счёт выставлен — «Ждём вашей оплаты»', () => {
    expect(pointStage({ ...base, invoiced: true })).toBe('await_payment')
    expect(POINT_LINE.await_payment).toBe('Ждём вашей оплаты')
  })
  it('менеджер выставил счёт на свой просчёт — тоже ждём оплаты', () => {
    expect(pointStage({ ...base, submitted: false, invoiced: true })).toBe('await_payment')
  })
  it('оплачен, ещё не запущен — запускаем', () => {
    expect(pointStage({ ...base, invoiced: true, paid: true })).toBe('paid')
  })
  it('черновик без счёта, запущенный заказ, не точка — без строки', () => {
    expect(pointStage({ ...base, submitted: false })).toBeNull()
    expect(pointStage({ ...base, launched: true })).toBeNull()
    expect(pointStage({ ...base, isPoint: false, invoiced: true })).toBeNull()
  })
})

describe('отметка «Оплачен»', () => {
  it('payment_status=paid или этап invoice_paid с датой', () => {
    expect(markedPaid({ payment_status: 'paid' })).toBe(true)
    expect(markedPaid({ stages: { invoice_paid: '2026-10-03' } })).toBe(true)
    expect(markedPaid({ payment_status: 'partial', prepayment_amount: 5000 })).toBe(false)
    expect(markedPaid({ stages: { invoice_paid: null } })).toBe(false)
  })
})
