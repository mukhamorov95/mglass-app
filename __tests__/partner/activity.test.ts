import { describe, it, expect } from 'vitest'
import { buildEvents, waitingActions, type ActivityOrder } from '@/lib/partner/activity'

const NOW = Date.parse('2026-10-07T12:00:00Z')

const fresh: ActivityOrder = {
  id: 5642, number: '0245-1', created_at: '2026-10-01T08:00:00Z', launched_at: '2026-10-02',
  notes: {
    status: 'sent', launched_at: '2026-10-02',
    stages: { cut: '2026-10-03', edge_processed: '2026-10-04T09:12:00.000Z', packaged: '2026-10-06T10:00:00.000Z' },
    drawing_url: 'order-drawings/5642.pdf',
  },
}
const oldShipped: ActivityOrder = {
  id: 100, number: '#100', created_at: '2025-11-01T08:00:00Z', launched_at: '2025-11-02',
  notes: { status: 'confirmed', stages: { cut: true, edge: true, packed: true, shipped: true } },
}

describe('табло — последние события по датам, а не последние созданные заказы', () => {
  it('отметки цеха, оплата и документы — по убыванию даты; true без даты не попадает', () => {
    const ev = buildEvents([fresh, oldShipped],
      [{ orderId: 5642, amount: 12000, paidAt: '2026-10-05' }],
      [{ orderId: 5642, at: '2026-10-07', text: 'Выдан УПД № 533' }])
    expect(ev.map(e => `${e.number}: ${e.text.replace(/\s/g, ' ')}`)).toEqual([
      '0245-1: Выдан УПД № 533',
      '0245-1: Упакован — готов к выдаче',
      '0245-1: Получена оплата 12 000 ₽',
      '0245-1: Кромка обработана',
      '0245-1: Резка выполнена',
      '0245-1: Запущен в работу',
      '#100: Запущен в работу',
    ])
  })
  it('решения менеджера по просчёту — из истории статусов', () => {
    const q: ActivityOrder = { id: 7, number: '#7', created_at: '2026-10-01T08:00:00Z', launched_at: null,
      notes: { status: 'rejected', status_history: [{ from: 'quote', to: 'rejected', date: '2026-10-06T10:00:00Z', comment: 'дорого' }] } }
    expect(buildEvents([q], [], [])[0].text).toBe('Менеджер отклонил просчёт')
  })
  it('оплата по чужому заказу не попадает', () => {
    expect(buildEvents([fresh], [{ orderId: 999, amount: 1, paidAt: '2026-10-07' }], [])).not.toContainEqual(expect.objectContaining({ orderId: 999 }))
  })
})

describe('ждут вашего действия', () => {
  const none = { drawingOpen: () => false, point: () => null, now: NOW }

  it('готов, способ получения не выбран — просим выбрать', () => {
    const w = waitingActions([fresh], none)
    expect(w).toEqual([{ kind: 'delivery', orderId: 5642, number: '0245-1', text: 'Готов — выберите доставку или самовывоз' }])
  })
  it('способ выбран — ничего не ждём', () => {
    expect(waitingActions([{ ...fresh, notes: { ...fresh.notes, delivery: { method: 'pickup' } } }], none)).toEqual([])
  })
  it('чертёж — только до начала производства и если решения нет', () => {
    const launchedNoMarks: ActivityOrder = { ...fresh, notes: { status: 'sent', drawing_url: 'x', delivery: { method: 'pickup' } } }
    expect(waitingActions([launchedNoMarks], { ...none, drawingOpen: () => true }).map(w => w.kind)).toEqual(['drawing'])
    expect(waitingActions([fresh], { ...none, drawingOpen: () => true }).map(w => w.kind)).toEqual(['delivery'])
  })
  it('точка со счётом — оплата первой строкой', () => {
    const q: ActivityOrder = { id: 8, number: '#8', created_at: '2026-10-06T08:00:00Z', launched_at: null, notes: { status: 'pending_approval' } }
    const w = waitingActions([fresh, q], { ...none, point: o => (o.id === 8 ? 'await_payment' : null) })
    expect(w[0]).toEqual({ kind: 'payment', orderId: 8, number: '#8', text: 'Ждём вашей оплаты' })
  })
  it('старые неотмеченные заказы не дёргают партнёра', () => {
    const stale: ActivityOrder = { id: 9, number: '#9', created_at: '2026-06-01T08:00:00Z', launched_at: '2026-06-02', notes: { status: 'sent', stages: { packaged: '2026-06-10' } } }
    expect(waitingActions([stale, oldShipped], none)).toEqual([])
  })
})
