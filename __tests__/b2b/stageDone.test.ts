import { describe, it, expect } from 'vitest'
import { markDone, stagesOf, stageMark, isStageDone, stageDate } from '@/lib/b2b/stageDone'

// Формы notes.stages сняты с прода 07.10: true без даты, 'YYYY-MM-DD', ISO-время,
// false/null у недоотмеченных старых заказов; ключи edge/packed у старых, edge_processed/packaged у новых.
describe('этап пройден', () => {
  it('true, дата и ISO-время — пройден; false, null, пусто — нет', () => {
    expect(markDone(true)).toBe(true)
    expect(markDone('2026-10-07')).toBe(true)
    expect(markDone('2026-10-07T13:55:03.947Z')).toBe(true)
    expect(markDone(false)).toBe(false)
    expect(markDone(null)).toBe(false)
    expect(markDone(undefined)).toBe(false)
    expect(markDone('')).toBe(false)
    expect(markDone('  ')).toBe(false)
  })

  it('старые ключи edge/packed засчитываются за edge_processed/packaged', () => {
    const old = { printed: true, material_ordered: true, cut: true, edge: true, drilled: true, tempering: true, packed: true, shipped: true }
    expect(isStageDone(old, 'edge_processed')).toBe(true)
    expect(isStageDone(old, 'packaged')).toBe(true)
    expect(isStageDone({ edge: false, packed: false }, 'packaged')).toBe(false)
    expect(isStageDone({ edge: false }, 'edge_processed')).toBe(false)
  })

  it('новый ключ важнее старого, если отмечены оба', () => {
    expect(stageMark({ packaged: '2026-10-06', packed: true }, 'packaged')).toBe('2026-10-06')
  })

  it('дата отметки — только у строки-даты; у true даты нет', () => {
    expect(stageDate({ shipped: '2026-10-07T13:55:03.947Z' }, 'shipped')).toBe('2026-10-07T13:55:03.947Z')
    expect(stageDate({ cut: '2026-10-03' }, 'cut')).toBe('2026-10-03')
    expect(stageDate({ shipped: true }, 'shipped')).toBeNull()
    expect(stageDate({ shipped: 'true' }, 'shipped')).toBeNull()
  })

  it('stages читается из notes безопасно', () => {
    expect(stagesOf({ stages: { cut: true } })).toEqual({ cut: true })
    expect(stagesOf({})).toEqual({})
    expect(stagesOf({ stages: [1] })).toEqual({})
    expect(stagesOf(null)).toEqual({})
  })
})
