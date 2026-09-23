import { describe, it, expect } from 'vitest'
import { isDone, scoreCoaching, type Evidence } from '@/lib/coaching/effectRules'
import type { Coaching, FocusItem } from '@/lib/coaching/rules'

const SEMEN = 13677554
const item = (over: Partial<FocusItem>): FocusItem =>
  ({ kind: 'waiting_chat', title: 'Ответь в чате', detail: '', url: 'u', at: 1, weight: 75, leadId: 10, ...over })
const ev = (over: Partial<Evidence> = {}): Evidence =>
  ({ touchedLeads: new Set<number>(), calledPhones: new Set<string>(), overdueNow: new Map<number, number>(), ...over })

describe('закрыт ли повод', () => {
  it('по карточке было исходящее — закрыт', () => {
    expect(isDone(item({}), SEMEN, ev({ touchedLeads: new Set([10]) }))).toBe(true)
    expect(isDone(item({}), SEMEN, ev())).toBe(false)
  })
  it('номер без карточки — закрыт, если на него звонили после снимка', () => {
    const it = item({ kind: 'missed_call', leadId: null, url: 'tel:+79260255476' })
    expect(isDone(it, SEMEN, ev({ calledPhones: new Set(['9260255476']) }))).toBe(true)
    expect(isDone(it, SEMEN, ev({ calledPhones: new Set(['9990001122']) }))).toBe(false)
  })
  it('задачи — закрыт, если просроченных стало меньше', () => {
    const it = item({ kind: 'overdue_tasks', leadId: null, title: 'Разбери просроченные задачи: 113', url: null })
    expect(isDone(it, SEMEN, ev({ overdueNow: new Map([[SEMEN, 100]]) }))).toBe(true)
    expect(isDone(it, SEMEN, ev({ overdueNow: new Map([[SEMEN, 113]]) }))).toBe(false)
  })
  it('считает итог и разбивку по видам', () => {
    const c = { amoUserId: SEMEN, focus: [item({}), item({ leadId: 11 }), item({ kind: 'new_lead', leadId: 12 })] } as Coaching
    const s = scoreCoaching(c, ev({ touchedLeads: new Set([10, 12]) }))
    expect(s).toMatchObject({ items: 3, done: 2 })
    expect(s.byKind.waiting_chat).toEqual({ items: 2, done: 1 })
    expect(s.byKind.new_lead).toEqual({ items: 1, done: 1 })
  })
})
