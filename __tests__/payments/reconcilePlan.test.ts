import { describe, it, expect } from 'vitest'
import { reconcileOrder, type ReconcileOrder } from '@/lib/payments/reconcilePlan'

const base: ReconcileOrder = { paid: true, partial: false, total: 10000, prepay: 0, prepayKey: undefined, settleKey: undefined, paidOther: 0 }

describe('ночная сверка оплат B2B', () => {
  it('«Оплачен» без платежа — дописывает всю сумму', () => {
    expect(reconcileOrder(base)).toEqual([{ op: 'insert', part: 'settlement', amount: 10000, kind: 'full' }])
  })

  it('платёж кнопки «Оплачен» уже есть — не трогает (автор отметки остаётся)', () => {
    expect(reconcileOrder({ ...base, settleKey: 'live' })).toEqual([])
  })

  it('«остаток» снят кнопкой, потому что деньги пришли по выписке, — не оживляет', () => {
    expect(reconcileOrder({ ...base, settleKey: 'voided', paidOther: 10000 })).toEqual([])
  })

  it('часть пришла по выписке — дописывает только остаток', () => {
    expect(reconcileOrder({ ...base, paidOther: 6000 })).toEqual([{ op: 'insert', part: 'settlement', amount: 4000, kind: 'remainder' }])
  })

  it('по выписке пришло всё — ничего не дописывает', () => {
    expect(reconcileOrder({ ...base, paidOther: 9999.5 })).toEqual([])
  })

  it('предоплата из notes без платежа — дописывает её и остаток за вычетом', () => {
    expect(reconcileOrder({ ...base, prepay: 3000 })).toEqual([
      { op: 'insert', part: 'prepayment', amount: 3000, kind: 'prepayment' },
      { op: 'insert', part: 'settlement', amount: 7000, kind: 'remainder' },
    ])
  })

  it('частичная оплата: предоплата есть — не трогает, живой «остаток» снимает', () => {
    expect(reconcileOrder({ ...base, paid: false, partial: true, prepay: 3000, prepayKey: 'live', settleKey: 'live' }))
      .toEqual([{ op: 'void', part: 'settlement' }])
  })

  it('оплату сняли — живые платежи кнопки снимаются, снятые не трогаются', () => {
    expect(reconcileOrder({ ...base, paid: false, prepayKey: 'voided', settleKey: 'live' }))
      .toEqual([{ op: 'void', part: 'settlement' }])
  })
})
