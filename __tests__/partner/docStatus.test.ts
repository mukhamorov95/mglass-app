import { describe, expect, it } from 'vitest'
import { inDocFilter, payBadge, shipBadge } from '@/lib/partner/docStatus'

describe('плашки документов кабинета', () => {
  it('у просчёта плашек нет и в фильтрах он только во «Все»', () => {
    const q = { lane: 'quote', payment: null }
    expect(payBadge(q)).toBeNull()
    expect(shipBadge(q)).toBeNull()
    expect(inDocFilter(q, 'all')).toBe(true)
    expect(inDocFilter(q, 'unpaid')).toBe(false)
    expect(inDocFilter(q, 'unshipped')).toBe(false)
  })
  it('не оплачен — красный, оплачен — зелёный, частично — жёлтый', () => {
    expect(payBadge({ lane: 'in_work', payment: { status: 'awaiting', total: 1000 } })).toEqual({ label: 'Не оплачен', tone: 'bad' })
    expect(payBadge({ lane: 'shipped', payment: { status: 'paid' } })).toEqual({ label: 'Оплачен', tone: 'ok' })
    expect(payBadge({ lane: 'in_work', payment: { status: 'partial', paid: 400, total: 1000, remainder: 600 } })?.tone).toBe('part')
  })
  it('без права видеть оплату плашки оплаты нет', () => {
    expect(payBadge({ lane: 'in_work', payment: null })).toBeNull()
  })
  it('отгрузка: отгружен, частично, не отгружен', () => {
    expect(shipBadge({ lane: 'shipped' })?.tone).toBe('ok')
    expect(shipBadge({ lane: 'in_work', shipPartial: { shipped: 2, total: 5 } })).toEqual({ label: 'Отгружено 2 из 5 шт.', tone: 'part' })
    expect(shipBadge({ lane: 'in_work' })?.tone).toBe('bad')
  })
  it('фильтры', () => {
    const unpaidShipped = { lane: 'shipped', payment: { status: 'awaiting' as const, total: 5 } }
    expect(inDocFilter(unpaidShipped, 'unpaid')).toBe(true)
    expect(inDocFilter(unpaidShipped, 'shipped')).toBe(true)
    expect(inDocFilter(unpaidShipped, 'paid')).toBe(false)
    expect(inDocFilter(unpaidShipped, 'unshipped')).toBe(false)
    expect(inDocFilter({ lane: 'in_work', payment: { status: 'own_cost' } }, 'paid')).toBe(true)
  })
})
