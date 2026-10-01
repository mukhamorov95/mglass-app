import { describe, expect, it } from 'vitest'
import { summarizeOwner, type OwnerRow } from '@/lib/measure/ownerSummary'

const row = (p: Partial<OwnerRow>): OwnerRow => ({
  id: Math.floor(Math.random() * 1e9), status: 'new', is_repeat: false, created_at: '2026-10-01T09:00:00Z',
  scheduled_at: null, visit_payment: null, fee_status: 'pending', measurer_fee: 0, ...p,
})

describe('summarizeOwner', () => {
  const today = '2026-10-20'

  it('новые и повторные считаются раздельно, отменённые — отдельно', () => {
    const s = summarizeOwner([
      row({}), row({}), row({ is_repeat: true }),
      row({ status: 'cancelled' }),
      row({ created_at: '2026-09-28T09:00:00Z' }), // прошлый месяц — не в «создано»
    ], today)
    expect(s.created).toEqual({ new: 2, repeat: 1 })
    expect(s.cancelled).toBe(1)
  })

  it('граница месяца — по Москве: 30.09 22:30 UTC — это уже октябрь', () => {
    const s = summarizeOwner([row({ created_at: '2026-09-30T22:30:00Z' })], today)
    expect(s.created.new).toBe(1)
  })

  it('выполненные — по дате замера; доля «на объекте» — из отмеченных', () => {
    const s = summarizeOwner([
      row({ status: 'done', scheduled_at: '2026-10-05T09:00:00Z', visit_payment: 'onsite' }),
      row({ status: 'done', scheduled_at: '2026-10-06T09:00:00Z', visit_payment: 'company', is_repeat: true }),
      row({ status: 'done', scheduled_at: '2026-10-07T09:00:00Z' }),
      row({ status: 'done', scheduled_at: '2026-09-29T09:00:00Z', visit_payment: 'onsite' }),
    ], today)
    expect(s.done).toEqual({ new: 2, repeat: 1 })
    expect(s.paidOnsite).toEqual({ onsite: 1, marked: 2 })
  })

  it('пул, самая старая заявка, сложности, не отмеченные в срок', () => {
    const s = summarizeOwner([
      row({ created_at: '2026-10-17T10:00:00Z' }),
      row({ created_at: '2026-10-19T10:00:00Z' }),
      row({ status: 'issue' }),
      row({ status: 'scheduled', scheduled_at: '2026-10-18T09:00:00Z' }),
      row({ status: 'scheduled', scheduled_at: '2026-10-20T09:00:00Z' }), // сегодня — ещё не просрочен
    ], today)
    expect(s.pool).toEqual({ count: 2, oldestDays: 3 })
    expect(s.issues).toBe(1)
    expect(s.overdue).toBe(1)
  })

  it('долг компании — за всё время, на объекте и выплаченное не в долге; строка не считается дважды', () => {
    const owed = row({ id: 7, status: 'done', scheduled_at: '2026-08-01T09:00:00Z', visit_payment: 'company', measurer_fee: 2500 })
    const s = summarizeOwner([
      owed, owed,
      row({ status: 'done', scheduled_at: '2026-10-02T09:00:00Z', visit_payment: 'unpaid', measurer_fee: '1500' }),
      row({ status: 'done', scheduled_at: '2026-10-03T09:00:00Z', visit_payment: 'onsite', measurer_fee: 2500 }),
      row({ status: 'done', scheduled_at: '2026-10-04T09:00:00Z', visit_payment: 'company', fee_status: 'paid', measurer_fee: 2500 }),
    ], today)
    expect(s.owed).toBe(4000)
  })
})
