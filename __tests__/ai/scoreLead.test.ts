import { describe, it, expect } from 'vitest'
import { scoreLead } from '@/lib/avito/scoreLead'
import { CORE_KEYS } from '@/lib/avito/flags'

describe('scoreLead — светофор', () => {
  it('пустой лид — холодный, ничего не собрано', () => {
    const s = scoreLead({})
    expect(s.heat).toBe('cold')
    expect(s.isHot).toBe(false)
    expect(s.readiness).toBe(0)
    expect(s.coreDone).toBe(0)
    expect(s.missingNext).toBe('product') // первый по ASK_ORDER
  })

  it('часть флагов — тёплый, бот добирает недостающее', () => {
    const s = scoreLead({ product: true, sizes: true })
    expect(s.heat).toBe('warm')
    expect(s.isHot).toBe(false)
    expect(s.readiness).toBeGreaterThan(0)
    expect(s.missingNext).toBe('place') // product+sizes есть → следующий place
  })

  it('всё ядро собрано — горячий, уходит человеку', () => {
    const flags = Object.fromEntries(CORE_KEYS.map(k => [k, true]))
    const s = scoreLead(flags)
    expect(s.isHot).toBe(true)
    expect(s.heat).toBe('hot')
    expect(s.coreDone).toBe(s.coreTotal)
    expect(s.missingNext).toBeNull()
  })

  it('быстрый путь: готов на замер + телефон → горячий даже без полного ядра', () => {
    const s = scoreLead({ ready_measure: true, contact: true })
    expect(s.isHot).toBe(true)
    expect(s.heat).toBe('hot')
    expect(s.reason).toContain('замер')
  })

  it('«закрыт на замер» = согласие + телефон + адрес + готовность', () => {
    expect(scoreLead({ measure_agreed: true, contact: true, address_known: true, object_ready: true }).measureClosed).toBe(true)
    expect(scoreLead({ measure_agreed: true, contact: true }).measureClosed).toBe(false)
    expect(scoreLead({ measure_agreed: true, contact: true, address_known: true, object_ready: true, refused: true }).measureClosed).toBe(false)
  })

  it('готов на замер БЕЗ телефона — ещё не горячий', () => {
    const s = scoreLead({ ready_measure: true })
    expect(s.isHot).toBe(false)
    expect(s.heat).toBe('warm')
  })

  it('дисквалификация гасит лид независимо от других флагов', () => {
    const flags = { ...Object.fromEntries(CORE_KEYS.map(k => [k, true])), not_our_profile: true }
    const s = scoreLead(flags)
    expect(s.disqualified).toBe(true)
    expect(s.isHot).toBe(false)
    expect(s.heat).toBe('cold')
    expect(s.readiness).toBe(0)
    expect(s.missingNext).toBeNull()
  })

  it('«дорого» не гасит лид (refused не выставлен) — путь к price_ok открыт', () => {
    const s = scoreLead({ product: true, sizes: true, price_quoted: true })
    expect(s.disqualified).toBe(false)
    expect(s.heat).toBe('warm')
  })

  it('readiness растёт монотонно при добавлении флагов', () => {
    const a = scoreLead({ product: true })
    const b = scoreLead({ product: true, sizes: true })
    const c = scoreLead({ product: true, sizes: true, contact: true })
    expect(b.readiness).toBeGreaterThan(a.readiness)
    expect(c.readiness).toBeGreaterThan(b.readiness)
    expect(c.readiness).toBeLessThanOrEqual(100)
  })
})
