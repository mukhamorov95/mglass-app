import { describe, it, expect } from 'vitest'
import { configuratorCode, LEGACY_TO_CONFIGURATOR } from '@/lib/configurator/legacyModelMap'
import { M_MODELS } from '@/lib/configurator/arrangement'

describe('legacyModelMap', () => {
  it('маппит девять моделей латиница→кириллица', () => {
    expect(configuratorCode('M1')).toBe('М1')
    expect(configuratorCode('M4')).toBe('М4')
    expect(configuratorCode('M12')).toBe('М12')
  })

  it('возвращает null для моделей без комплекта в новом ряду (M3/M5/M6)', () => {
    expect(configuratorCode('M3')).toBeNull()
    expect(configuratorCode('M5')).toBeNull()
    expect(configuratorCode('M6')).toBeNull()
  })

  it('возвращает null для неизвестного id', () => {
    expect(configuratorCode('M99')).toBeNull()
    expect(configuratorCode('')).toBeNull()
  })

  it('латинский M на входе, кириллический М на выходе — не одна и та же буква', () => {
    const out = configuratorCode('M1')!
    expect(out.charCodeAt(0)).toBe('М'.charCodeAt(0))       // кириллическая М (U+041C)
    expect(out.charCodeAt(0)).not.toBe('M'.charCodeAt(0))   // не латинская M (U+004D)
  })

  it('каждый выходной код существует в модельном ряду конфигуратора', () => {
    const codes = new Set(M_MODELS.map(m => m.code))
    for (const cyr of Object.values(LEGACY_TO_CONFIGURATOR)) {
      expect(codes.has(cyr)).toBe(true)
    }
  })

  it('покрывает ровно девять моделей конфигуратора', () => {
    expect(Object.keys(LEGACY_TO_CONFIGURATOR)).toHaveLength(M_MODELS.length)
    expect(M_MODELS.length).toBe(9)
  })
})
