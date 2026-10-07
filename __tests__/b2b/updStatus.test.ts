import { describe, it, expect } from 'vitest'
import { updCardState, type UpdStatus } from '@/lib/b2b/updStatus'

const s = (p: Partial<UpdStatus> = {}): UpdStatus => ({
  issued: {}, eligible: [5630], series: { pendingSql: false, set: true }, ...p,
})

describe('УПД у заказа в списке', () => {
  it('выдан — номер, независимо от отгрузки и серии', () => {
    const st = s({ issued: { 5630: { number: 533, year: 2026, doc_date: '2026-10-08' } }, series: { pendingSql: false, set: false } })
    expect(updCardState(5630, false, st)).toEqual({ kind: 'issued', number: 533, docDate: '2026-10-08' })
  })

  it('отгружен, ИНН есть, серия включена, УПД нет — выдать', () => {
    expect(updCardState(5630, true, s())).toEqual({ kind: 'issue' })
  })

  it('без призыва: не отгружен, нет ИНН, серия не включена, SQL нет, статус не загрузился', () => {
    expect(updCardState(5630, false, s())).toEqual({ kind: 'none' })
    expect(updCardState(5631, true, s())).toEqual({ kind: 'none' })
    expect(updCardState(5630, true, s({ series: { pendingSql: false, set: false } }))).toEqual({ kind: 'none' })
    expect(updCardState(5630, true, s({ series: { pendingSql: true, set: false } }))).toEqual({ kind: 'none' })
    expect(updCardState(5630, true, null)).toEqual({ kind: 'none' })
  })
})
