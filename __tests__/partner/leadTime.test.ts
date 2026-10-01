import { describe, it, expect } from 'vitest'
import { leadTimeFor, leadTimeText } from '@/lib/partner/leadTime'

const base = { hasTempering: false, hasFacet: false, hasHoles: false, shape: 'rect' as const, hasTriplex: false }

describe('срок по сложности — по самой сложной позиции', () => {
  it('простое зеркало — 2–3 дня', () => expect(leadTimeText([base])).toBe('2–3 рабочих дней'))
  it('фацет, отверстия или фигура без закалки — 3–5', () => {
    for (const s of [{ ...base, hasFacet: true }, { ...base, hasHoles: true }, { ...base, shape: 'curved' as const }])
      expect(leadTimeFor([s])).toEqual({ min: 3, max: 5 })
  })
  it('одна закалённая позиция делает весь заказ 7–10', () => expect(leadTimeFor([base, { ...base, hasFacet: true }, { ...base, hasTempering: true }])).toEqual({ min: 7, max: 10 }))
  it('триплекс — срок числом не обещаем', () => expect(leadTimeText([base, { ...base, hasTriplex: true }])).toBe('срок подтверждаем при заказе'))
  it('пустой заказ — без срока', () => expect(leadTimeFor([])).toBeNull())
})
