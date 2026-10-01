import { describe, it, expect } from 'vitest'
import { leadTimeFor, leadTimeText, isMirrorCategory } from '@/lib/partner/leadTime'

const base = { hasTempering: false, hasFacet: false, hasHoles: false, shape: 'rect' as const, hasTriplex: false }

describe('срок по сложности — по самой сложной позиции', () => {
  it('простое зеркало — 1–2 дня (решение владельца 01.10)', () => expect(leadTimeText([{ ...base, isMirror: true }])).toBe('1–2 рабочих дня'))
  it('простое стекло без закалки — 2–3 дня', () => expect(leadTimeText([base])).toBe('2–3 рабочих дня'))
  it('зеркало с фацетом — уже 3–5', () => expect(leadTimeFor([{ ...base, isMirror: true, hasFacet: true }])).toEqual({ min: 3, max: 5 }))
  it('зеркало + простое стекло — по стеклу, 2–3', () => expect(leadTimeFor([{ ...base, isMirror: true }, base])).toEqual({ min: 2, max: 3 }))
  it('фацет, отверстия или фигура без закалки — 3–5', () => {
    for (const s of [{ ...base, hasFacet: true }, { ...base, hasHoles: true }, { ...base, shape: 'curved' as const }])
      expect(leadTimeFor([s])).toEqual({ min: 3, max: 5 })
  })
  it('одна закалённая позиция делает весь заказ 7–10', () => expect(leadTimeFor([base, { ...base, hasFacet: true }, { ...base, hasTempering: true }])).toEqual({ min: 7, max: 10 }))
  it('триплекс — срок числом не обещаем', () => expect(leadTimeText([base, { ...base, hasTriplex: true }])).toBe('срок подтверждаем при заказе'))
  it('3–5 и 7–10 — «дней»', () => {
    expect(leadTimeText([{ ...base, hasFacet: true }])).toBe('3–5 рабочих дней')
    expect(leadTimeText([{ ...base, hasTempering: true }])).toBe('7–10 рабочих дней')
  })
  it('пустой заказ — без срока', () => expect(leadTimeFor([])).toBeNull())
  it('зеркало — по категории справочника', () => {
    expect(isMirrorCategory('зеркало')).toBe(true)
    expect(isMirrorCategory('стекло')).toBe(false)
  })
})
