import { describe, it, expect } from 'vitest'
import { buildClientTimeline } from '@/lib/b2b/clientTimeline'

describe('лента событий клиента', () => {
  it('пустые notes — пустая лента, ничего не выдумываем', () => {
    expect(buildClientTimeline({})).toEqual([])
  })

  it('собирает путь клиента в хронологии', () => {
    const events = buildClientTimeline({
      public_token: 'x'.repeat(32),
      public_opened_at: '2026-08-20T10:00:00Z',
      client_response: { action: 'approve', comment: 'ок', at: '2026-08-21T10:00:00Z' },
      payment_status: 'paid',
      paid_at: '2026-08-22',
      shipped_date: '2026-08-25',
    })
    expect(events.map(e => e.icon)).toEqual(['👀', '✅', '💰', '📦', '🔗'])
    expect(events[1].text).toContain('«ок»')
    expect(events[1].tone).toBe('good')
  })

  it('вопрос клиента и возврат чертежа помечены как требующие внимания', () => {
    const events = buildClientTimeline({
      client_response: { action: 'question', comment: 'а закалка?', at: '2026-08-21T10:00:00Z' },
      drawing_approval: { status: 'rework', comment: 'не тот радиус', at: '2026-08-22T10:00:00Z' },
    })
    expect(events.every(e => e.tone === 'warn')).toBe(true)
  })

  it('различает, кто выбрал доставку — клиент или мы', () => {
    const byPartner = buildClientTimeline({ delivery: { method: 'delivery', address: 'Москва', by: 'partner', at: '2026-08-21T10:00:00Z' } })
    expect(byPartner[0].text).toContain('Клиент выбрал доставку — Москва')
    const byUs = buildClientTimeline({ delivery: { method: 'pickup', by: 'Влад', at: '2026-08-21T10:00:00Z' } })
    expect(byUs[0].text).toContain('Указали самовывоз')
  })
})
