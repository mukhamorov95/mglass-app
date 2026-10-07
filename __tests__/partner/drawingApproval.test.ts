import { describe, it, expect } from 'vitest'
import { decisionOf, drawingStoragePath, isDecisionStale } from '@/lib/partner/drawingApproval'

describe('решение по чертежу после нового файла', () => {
  const rework = decisionOf({ status: 'rework', comment: 'сдвинуть отверстие', at: '2026-10-06T09:00:00.000Z', by: 'partner' })

  it('файл загружен позже «На доработку» — решение устарело, спрашиваем снова', () => {
    expect(isDecisionStale(rework, '2026-10-06T12:30:00.000Z')).toBe(true)
  })
  it('файл старше решения — решение в силе', () => {
    expect(isDecisionStale(rework, '2026-10-05T16:00:00.000Z')).toBe(false)
  })
  it('время файла не прочитали — решение не трогаем', () => {
    expect(isDecisionStale(rework, null)).toBe(false)
    expect(isDecisionStale(decisionOf({ status: 'approved' }), '2026-10-06T12:30:00.000Z')).toBe(false)
  })
  it('решения нет или оно неизвестного вида', () => {
    expect(decisionOf(undefined)).toBeNull()
    expect(decisionOf({ status: 'maybe' })).toBeNull()
    expect(isDecisionStale(null, '2026-10-06T12:30:00.000Z')).toBe(false)
  })
  it('путь файла — и из пути в бакете, и из старого publicUrl', () => {
    expect(drawingStoragePath('order-drawings/5642.pdf')).toBe('order-drawings/5642.pdf')
    expect(drawingStoragePath('https://x.supabase.co/storage/v1/object/public/b2b-attachments/order-drawings/5642.pdf?t=1')).toBe('order-drawings/5642.pdf')
  })
})
