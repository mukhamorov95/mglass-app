import { describe, it, expect } from 'vitest'
import { invoiceState, INVOICE_HINT } from '@/lib/partner/documents'

describe('счёт в «Документах» кабинета', () => {
  it('просчёт — счёт после запуска', () => {
    expect(invoiceState({ launched: false, canSelfInvoice: true })).toBe('after_launch')
  })
  it('в работе с самообслуживанием — счёт открыт', () => {
    expect(invoiceState({ launched: true, canSelfInvoice: true })).toBe('open')
  })
  it('в работе без самообслуживания — подсказка «пришлёт менеджер» только здесь', () => {
    expect(invoiceState({ launched: true, canSelfInvoice: false })).toBe('manager')
    expect(INVOICE_HINT.manager).toMatch(/менеджер/)
    expect(INVOICE_HINT.after_launch).not.toMatch(/менеджер/)
  })
})

describe('счёт точки на рынке (Т6: 100 % до запуска)', () => {
  it('до выставления счёта — «после проверки суммы», а не «после запуска»', () => {
    expect(invoiceState({ launched: false, canSelfInvoice: false, isPoint: true, invoiced: false })).toBe('after_check')
  })
  it('счёт выставлен — открыт до запуска, даже без самообслуживания', () => {
    expect(invoiceState({ launched: false, canSelfInvoice: false, isPoint: true, invoiced: true })).toBe('open')
  })
  it('не точка с выставленным счётом — правило прежнее', () => {
    expect(invoiceState({ launched: false, canSelfInvoice: true, isPoint: false, invoiced: true })).toBe('after_launch')
    expect(invoiceState({ launched: true, canSelfInvoice: false, isPoint: false, invoiced: true })).toBe('manager')
  })
})
