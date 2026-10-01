import { describe, it, expect } from 'vitest'
import { applyActualPrice, companyOwes, finalPrice, summarizeEarnings, type EarningRow } from '@/lib/measure/money'

describe('цена от замерщика', () => {
  it('менеджер заложил 2 500, замерщик пишет 3 500 — цена менеджера остаётся, гонорар идёт за ценой', () => {
    const r = { visit_price: 2500, actual_price: null, measurer_fee: 2500 }
    expect(applyActualPrice(r, 3500, 'две душевые вместо одной')).toEqual({ actual_price: 3500, price_note: 'две душевые вместо одной', measurer_fee: 3500 })
    expect(finalPrice({ visit_price: 2500, actual_price: 3500 })).toBe(3500)
  })

  it('гонорар прописан отдельно — цена его не двигает', () => {
    expect(applyActualPrice({ visit_price: 2500, actual_price: null, measurer_fee: 2000 }, 3500, 'далеко').measurer_fee).toBe(2000)
  })

  it('гонорар не указан (0) — становится ценой', () => {
    expect(applyActualPrice({ visit_price: 0, actual_price: null, measurer_fee: 0 }, 3000, 'не указали').measurer_fee).toBe(3000)
  })

  it('повторная правка: гонорар уже шёл за прошлой поправкой — идёт и за новой', () => {
    expect(applyActualPrice({ visit_price: 2500, actual_price: 3500, measurer_fee: 3500 }, 3000, 'пересчитал')).toMatchObject({ actual_price: 3000, measurer_fee: 3000 })
  })

  it('вернул цену менеджера — поправки нет, причина стёрта', () => {
    expect(applyActualPrice({ visit_price: 2500, actual_price: 3500, measurer_fee: 3500 }, 2500, 'x')).toEqual({ actual_price: null, price_note: null, measurer_fee: 2500 })
  })
})

describe('долг компании замерщику', () => {
  const r = (p: Partial<EarningRow & { status: string }>) => ({ status: 'done', visit_payment: 'company' as const, fee_status: 'pending', measurer_fee: 3000, ...p })
  it('на объекте — компания не должна', () => expect(companyOwes(r({ visit_payment: 'onsite' }))).toBe(0))
  it('на компанию / не оплачено, не выплачено — должна гонорар', () => {
    expect(companyOwes(r({}))).toBe(3000)
    expect(companyOwes(r({ visit_payment: 'unpaid' }))).toBe(3000)
  })
  it('выплачено или не выполнен — не должна', () => {
    expect(companyOwes(r({ fee_status: 'paid' }))).toBe(0)
    expect(companyOwes(r({ status: 'scheduled' }))).toBe(0)
  })
})

describe('итоги «Заработка»', () => {
  const rows: EarningRow[] = [
    { status: 'done', visit_price: 2500, actual_price: null, measurer_fee: 2500, visit_payment: 'onsite', fee_status: 'pending' },
    { status: 'done', visit_price: 2500, actual_price: 3500, measurer_fee: 3500, visit_payment: 'company', fee_status: 'paid' },
    { status: 'done', visit_price: 3000, actual_price: null, measurer_fee: 3000, visit_payment: 'company', fee_status: 'pending' },
    { status: 'done', visit_price: 2000, actual_price: null, measurer_fee: 2000, visit_payment: 'unpaid', fee_status: 'pending' },
    { status: 'done', visit_price: 0, actual_price: null, measurer_fee: 0, visit_payment: null, fee_status: 'pending' },
    { status: 'scheduled', visit_price: 9999, actual_price: null, measurer_fee: 9999, visit_payment: null, fee_status: 'pending' },
  ]
  const s = summarizeEarnings(rows)

  it('считает только выполненные, по фактической цене', () => {
    expect(s.done).toEqual({ count: 5, sum: 11000 })
    expect(s.onsite).toEqual({ count: 1, sum: 2500 })
    expect(s.company).toEqual({ count: 2, sum: 6500 })
    expect(s.unpaid).toEqual({ count: 1, sum: 2000 })
    expect(s.unmarked).toEqual({ count: 1, sum: 0 })
    expect(s.noPrice).toBe(1)
  })

  it('тождество оплат сходится в штуках и рублях', () => {
    const parts = [s.onsite, s.company, s.unpaid, s.unmarked]
    expect(parts.reduce((a, x) => a + x.count, 0)).toBe(s.done.count)
    expect(parts.reduce((a, x) => a + x.sum, 0)).toBe(s.done.sum)
  })

  it('гонорар: на объекте + выплачено + должна компания = всего; не указанный — отдельно', () => {
    expect(s.fee).toEqual({ total: 11000, onsite: 2500, paidOut: 3500, owed: 5000, notSet: 1 })
    expect(s.fee.onsite + s.fee.paidOut + s.fee.owed).toBe(s.fee.total)
  })
})
