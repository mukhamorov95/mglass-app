import { describe, it, expect } from 'vitest'
import { quoteState, canEditQuote, canSubmitQuote, quoteLockReason } from '@/lib/partner/quoteState'

describe('просчёт партнёра до запуска', () => {
  it('черновик — правится и отправляется', () => {
    for (const s of [undefined, null, '', 'quote']) {
      expect(quoteState(s)).toBe('draft')
      expect(canEditQuote(quoteState(s))).toBe(true)
      expect(canSubmitQuote(quoteState(s))).toBe(true)
      expect(quoteLockReason(quoteState(s))).toBeNull()
    }
  })
  it('agreed / negotiation / rejected — не черновик: ни правки, ни «Отправить в работу»', () => {
    expect(quoteState('agreed')).toBe('agreed')
    expect(quoteState('negotiation')).toBe('negotiation')
    expect(quoteState('rejected')).toBe('rejected')
    expect(quoteState('cancelled')).toBe('rejected')
    for (const s of ['agreed', 'negotiation', 'rejected'] as const) {
      expect(canEditQuote(quoteState(s))).toBe(false)
      expect(canSubmitQuote(quoteState(s))).toBe(false)
      expect(quoteLockReason(quoteState(s))).toBeTruthy()
    }
  })
  it('отправленный партнёром — уже не черновик', () => {
    expect(quoteState('pending_approval')).toBe('submitted')
    expect(canEditQuote('submitted')).toBe(false)
  })
})
