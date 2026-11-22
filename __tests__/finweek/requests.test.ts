import { describe, it, expect } from 'vitest'
import { sumsOf, reservesByFund, proposalLimits, directiveShortages, paymentCheck, type ReqLike } from '@/lib/finplan/requests'

const W = '2026-11-25'
const req = (o: Partial<ReqLike>): ReqLike => ({ id: 1, fund_id: 10, amount: 100_000, approved_amount: null, status: 'pending', week_end: W, closed_at: null, ...o })

describe('приёмка №3: запрошено 100 000, одобрено 70 000, оплачено 50 000', () => {
  const q = req({ status: 'approved', approved_amount: 70_000, decision: 'partial' })
  const pays = [{ request_id: 1, amount: 50_000 }]
  it('четыре суммы и резерв 20 000', () => {
    expect(sumsOf(q, pays, true)).toEqual({ requested: 100_000, approved: 70_000, paid: 50_000, remaining: 20_000, reserve: 20_000 })
  })
  it('резерв фонда 20 000, пока неделя утверждена окончательно', () => {
    expect(reservesByFund([q], pays, new Set([W])).get(10)).toBe(20_000)
    expect(reservesByFund([q], pays, new Set()).get(10)).toBeUndefined()
  })
  it('несколько оплат по одной заявке складываются', () => {
    expect(sumsOf(q, [...pays, { request_id: 1, amount: 15_000.5 }], true).remaining).toBe(4_999.5)
  })
  it('цена снизилась: закрытие освобождает остаток резерва', () => {
    expect(sumsOf({ ...q, closed_at: '2026-11-27T10:00:00Z' }, pays, true)).toMatchObject({ remaining: 0, reserve: 0 })
  })
  it('цена выросла: оплата сверх остатка не проходит', () => {
    expect(paymentCheck(sumsOf(q, pays, true), 25_000)).toEqual({ ok: false, over: 5_000 })
    expect(paymentCheck(sumsOf(q, pays, true), 20_000)).toEqual({ ok: true, closes: true })
  })
})

describe('приёмка №4: свободно 80 000, две заявки по 60 000', () => {
  it('вторая получает только 20 000', () => {
    expect(proposalLimits(80_000, [{ id: 1, amount: 60_000 }, { id: 2, amount: 60_000 }])).toEqual([
      { id: 1, asked: 60_000, max: 60_000, short: 0 },
      { id: 2, asked: 60_000, max: 20_000, short: 40_000 },
    ])
  })
  it('обе целиком утвердить нельзя — директива показывает нехватку', () => {
    const free = new Map([[10, 80_000]])
    expect(directiveShortages(free, [{ fund_id: 10, amount: 60_000 }, { fund_id: 10, amount: 60_000 }]))
      .toEqual([{ fund_id: 10, free: 80_000, approved: 120_000, over: 40_000 }])
    expect(directiveShortages(free, [{ fund_id: 10, amount: 60_000 }, { fund_id: 10, amount: 20_000 }])).toEqual([])
  })
  it('уже зарезервированное другой неделей уменьшает свободное', () => {
    const old = req({ id: 7, status: 'approved', approved_amount: 30_000, week_end: '2026-11-18' })
    const res = reservesByFund([old], [], new Set(['2026-11-18']))
    expect(80_000 - (res.get(10) ?? 0)).toBe(50_000)
  })
})
