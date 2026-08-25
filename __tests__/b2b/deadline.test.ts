import { describe, it, expect } from 'vitest'
import { addWorkingDays, shipDateFrom, deadlineFor, DEFAULT_WORKING_DAYS } from '@/lib/b2b/deadline'

// А6: срок отгрузки считается в одном месте — менеджер при запуске и кабинет
// партнёра обязаны показывать клиенту одну и ту же дату.

describe('addWorkingDays', () => {
  it('пропускает выходные', () => {
    // пятница 2026-08-28 + 1 рабочий день = понедельник 31-е
    const d = addWorkingDays(new Date('2026-08-28T00:00:00Z'), 1)
    expect(d.toISOString().slice(0, 10)).toBe('2026-08-31')
  })
  it('15 рабочих дней от понедельника — через три недели', () => {
    const d = addWorkingDays(new Date('2026-08-24T00:00:00Z'), DEFAULT_WORKING_DAYS)
    expect(d.toISOString().slice(0, 10)).toBe('2026-09-14')
  })
})

describe('shipDateFrom', () => {
  it('production_days считаются календарными', () => {
    expect(shipDateFrom('2026-08-25T00:00:00Z', 7).toISOString().slice(0, 10)).toBe('2026-09-01')
  })
  it('без production_days — рабочие дни', () => {
    const a = shipDateFrom('2026-08-25T00:00:00Z', null)
    const b = addWorkingDays(new Date('2026-08-25T00:00:00Z'), DEFAULT_WORKING_DAYS)
    expect(a.getTime()).toBe(b.getTime())
  })
})

describe('deadlineFor', () => {
  const created = '2026-08-01T00:00:00Z'
  it('явная дата важнее всего', () => {
    const d = deadlineFor({ deadline_date: '2026-09-10', launched_at: '2026-08-25T00:00:00Z', production_days: 3 }, created)
    expect(d.toISOString().slice(0, 10)).toBe('2026-09-10')
  })
  it('иначе считает от запуска', () => {
    const d = deadlineFor({ launched_at: '2026-08-25T00:00:00Z', production_days: 5 }, created)
    expect(d.toISOString().slice(0, 10)).toBe('2026-08-30')
  })
  it('незапущенный просчёт — ориентир от даты создания', () => {
    const d = deadlineFor({}, created)
    expect(d.getTime()).toBe(addWorkingDays(new Date(created), DEFAULT_WORKING_DAYS).getTime())
  })
})
