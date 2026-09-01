import { describe, it, expect } from 'vitest'
import { countsForReferral } from '@/lib/referralTurnover'

describe('что считается в оборот партнёра', () => {
  it('обычный заказ считается', () => {
    expect(countsForReferral({ archived_at: null, notes: null })).toBe(true)
  })

  it('архивный, но ОТГРУЖЕННЫЙ считается — архив это уборка, а не отмена', () => {
    // 30.06.2026 одним действием в архив ушли 398 заказов, 352 из них отгружены.
    expect(countsForReferral({
      archived_at: '2026-06-30T12:00:00Z',
      notes: { stages: { shipped: '2026-06-20T10:00:00Z' } },
    })).toBe(true)
  })

  it('архивный, но запущенный в цех считается', () => {
    expect(countsForReferral({
      archived_at: '2026-06-30T12:00:00Z',
      notes: { launched_at: '2026-06-15T09:00:00Z' },
    })).toBe(true)
  })

  it('архивный и никогда не запускавшийся НЕ считается — это удалённая ошибка', () => {
    expect(countsForReferral({ archived_at: '2026-06-30T12:00:00Z', notes: {} })).toBe(false)
  })

  it('заметки строкой разбираются, а не отбрасываются', () => {
    expect(countsForReferral({
      archived_at: '2026-06-30T12:00:00Z',
      notes: JSON.stringify({ launched_at: '2026-06-15T09:00:00Z' }),
    })).toBe(true)
  })

  it('битые заметки у архивного не превращают его в засчитанный', () => {
    expect(countsForReferral({ archived_at: '2026-06-30T12:00:00Z', notes: 'не json' })).toBe(false)
  })

  it('пустые заметки у НЕархивного не мешают', () => {
    expect(countsForReferral({ archived_at: null, notes: 'мусор' })).toBe(true)
  })
})
