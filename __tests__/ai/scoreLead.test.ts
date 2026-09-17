import { describe, it, expect } from 'vitest'
import { scoreLead } from '@/lib/avito/scoreLead'
import { CORE_KEYS } from '@/lib/avito/flags'

describe('scoreLead — портрет клиента (решение владельца 17.09)', () => {
  it('портрет — это изделие, размеры, чистовая отделка и телефон', () => {
    expect([...CORE_KEYS].sort()).toEqual(['contact', 'finish_known', 'product', 'sizes'])
  })

  it('пустой лид — холодный, первым спрашиваем изделие', () => {
    const s = scoreLead({})
    expect(s.heat).toBe('cold')
    expect(s.isHot).toBe(false)
    expect(s.missingNext).toBe('product')
  })

  it('изделие и размеры — дальше чистовая отделка, а не место установки или фото', () => {
    const s = scoreLead({ product: true, sizes: true })
    expect(s.isHot).toBe(false)
    expect(s.missingNext).toBe('finish_known')
  })

  it('собран портрет — сразу менеджеру', () => {
    const s = scoreLead({ product: true, sizes: true, finish_known: true, contact: true })
    expect(s.isHot).toBe(true)
    expect(s.reason).toContain('портрет')
    expect(s.missingNext).toBeNull()
  })

  it('чистовая НЕ готова — всё равно менеджеру: известно, значит портрет собран', () => {
    expect(scoreLead({ product: true, sizes: true, finish_known: true, contact: true, stall: true }).isHot).toBe(true)
  })

  it('старые карточки: object_ready засчитывается как известная отделка', () => {
    expect(scoreLead({ product: true, sizes: true, object_ready: true, contact: true }).isHot).toBe(true)
  })

  it('спросил цену при известных изделии и размерах — менеджеру, без телефона', () => {
    const s = scoreLead({ product: true, sizes: true, price_asked: true })
    expect(s.isHot).toBe(true)
    expect(s.reason).toContain('цену')
  })

  it('спросил цену, но изделие неизвестно — бот сначала узнаёт изделие', () => {
    const s = scoreLead({ price_asked: true })
    expect(s.isHot).toBe(false)
    expect(s.missingNext).toBe('product')
  })

  it('сам готов на замер и дал телефон — менеджеру', () => {
    expect(scoreLead({ ready_measure: true, contact: true }).isHot).toBe(true)
  })

  it('место установки и фото бот не выспрашивает', () => {
    const s = scoreLead({ product: true, sizes: true, finish_known: true })
    expect(s.missingNext).toBe('contact')
  })

  it('дисквалификация гасит лид независимо от портрета', () => {
    const s = scoreLead({ product: true, sizes: true, finish_known: true, contact: true, not_our_profile: true })
    expect(s.disqualified).toBe(true)
    expect(s.isHot).toBe(false)
    expect(s.readiness).toBe(0)
  })

  it('readiness растёт с портретом и не выходит за 100', () => {
    const a = scoreLead({ product: true })
    const b = scoreLead({ product: true, sizes: true })
    const c = scoreLead({ product: true, sizes: true, contact: true })
    expect(b.readiness).toBeGreaterThan(a.readiness)
    expect(c.readiness).toBeGreaterThan(b.readiness)
    expect(c.readiness).toBeLessThanOrEqual(100)
  })
})
