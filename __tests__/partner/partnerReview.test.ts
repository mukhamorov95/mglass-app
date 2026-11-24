import { describe, it, expect } from 'vitest'
import { checkPatch, pickManager, reviewLine, reviewOf } from '@/lib/b2b/partnerReview'

const pending = { review: { requested_at: '2026-11-24T11:05:00Z', manager_id: 'u1', manager_name: 'Нуржан', telegram: false } }

describe('partnerReview', () => {
  it('запуск и согласование — «проверено и одобрено», кто и когда', () => {
    expect(checkPatch(pending, { kind: 'launch' }, '2026-11-24T12:20:00Z', 'Нуржан')).toEqual({ review: { ...pending.review, checked_at: '2026-11-24T12:20:00Z', checked_by: 'Нуржан', outcome: 'approved' } })
    expect((checkPatch(pending, { kind: 'status', to: 'agreed' }, 'x', 'Н').review as { outcome: string }).outcome).toBe('approved')
  })
  it('отказ — отклонено; нейтральный статус и уже проверенное — без отметки', () => {
    expect((checkPatch(pending, { kind: 'status', to: 'rejected' }, 'x', 'Н').review as { outcome: string }).outcome).toBe('rejected')
    expect(checkPatch(pending, { kind: 'status', to: 'sent' }, 'x', 'Н')).toEqual({})
    expect(checkPatch({ review: { ...pending.review, checked_at: 'y' } }, { kind: 'launch' }, 'x', 'Н')).toEqual({})
    expect(checkPatch({}, { kind: 'launch' }, 'x', 'Н')).toEqual({})
  })
  it('ответственный — назначенный, иначе частый автор', () => {
    expect(pickManager('a', ['b', 'b'])).toBe('a')
    expect(pickManager(null, ['b', 'c', 'b', null])).toBe('b')
    expect(pickManager(null, [])).toBeNull()
  })
  it('строка для экрана', () => {
    expect(reviewLine(reviewOf(pending)!)).toMatch(/пришло на проверку .* · Нуржан · ещё не проверено/)
  })
})
