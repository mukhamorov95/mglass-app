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
