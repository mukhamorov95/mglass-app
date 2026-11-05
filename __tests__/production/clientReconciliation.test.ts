import { describe, expect, it } from 'vitest'
import { buildReconciliation, debtText, paymentCountsAsMoney, shippedBy, type ReconOrder } from '@/lib/production/clientReconciliation'
import { isTransferMark } from '@/lib/payments/marks'

const order = (o: Partial<ReconOrder> & { id: number }): ReconOrder => ({
  no: `0${o.id}`, launchDay: '2026-10-01', live: true, amount: 1000, pieces: 10, full: null, events: [], payments: [], ...o,
})
const build = (orders: ReconOrder[], money: { day: string; amount: number; source: 'bank' | 'mark' }[], from = '2026-10-01', to = '2026-10-31') =>
  buildReconciliation({ clientName: 'Клиент', from, to, orders, money, bankFrom: '2026-09-01', bankTo: '2026-10-30', ledgerFrom: '2026-11-04' })

describe('акт сверки: два счёта долга', () => {
  // Пример владельца: оплачено 1000, из 10 штук уехало 4 на 400. Целиком не закрыт: должны всё. По изделиям: должны 600.
  const partial = order({ id: 1, payments: [{ day: '2026-10-05', amount: 1000 }], events: [{ day: '2026-10-10', amount: 400, pieces: 4 }] })
  const doc = build([partial], [{ day: '2026-10-05', amount: 1000, source: 'bank' }])

  it('считая только целые заказы, должны больше, чем считая уехавшие части', () => {
    expect(doc.whole.closing).toBe(1000)
    expect(doc.items.closing).toBe(600)
    expect(doc.whole.weOwe).toBe(1000)
    expect(doc.items.weOwe).toBe(600)
  })

  it('движение сходится: начало + оплачено − отгружено = конец', () => {
    for (const c of [doc.whole, doc.items]) expect(c.opening + doc.moneyInPeriod.total - c.shipped - c.undated).toBe(c.closing)
  })

  it('долг в обе стороны по заказам, они не схлопываются', () => {
    const d = build([
      order({ id: 1, payments: [{ day: '2026-10-05', amount: 1000 }] }),
      order({ id: 2, amount: 300, pieces: 1, full: { day: '2026-10-07' } }),
    ], [{ day: '2026-10-05', amount: 1000, source: 'bank' }])
    expect(d.whole.weOwe).toBe(1000)
    expect(d.whole.theyOwe).toBe(300)
    expect(d.whole.closing).toBe(700)
    expect(d.whole.unassigned).toBe(0)
  })

  it('деньги без разнесения по заказам видны отдельно и сводят итог', () => {
    const d = build([order({ id: 1, amount: 300, pieces: 1, full: { day: '2026-10-07' } })], [{ day: '2026-10-05', amount: 1000, source: 'bank' }])
    expect(d.whole.closing).toBe(700)
    expect(d.whole.theyOwe).toBe(300)
    expect(d.whole.unassigned).toBe(1000)
    expect(d.whole.weOwe - d.whole.theyOwe + d.whole.unassigned).toBe(d.whole.closing)
  })

  it('отметка сверх денег даёт минус в неразнесённом, а не мнимый приход', () => {
    const d = build([order({ id: 1, payments: [{ day: '2026-10-14', amount: 1000 }] })], [{ day: '2026-10-19', amount: 800, source: 'bank' }])
    expect(d.whole.closing).toBe(800)
    expect(d.whole.unassigned).toBe(-200)
  })
})

describe('акт сверки: даты и период', () => {
  it('отгрузка до периода входит в начало, а не в оборот', () => {
    const o = order({ id: 1, launchDay: '2026-09-01', amount: 500, pieces: 1, full: { day: '2026-09-20' } })
    const d = build([o], [])
    expect(d.whole.opening).toBe(-500)
    expect(d.whole.shipped).toBe(0)
    expect(d.whole.closing).toBe(-500)
  })

  it('отгрузка после конца периода не считается', () => {
    const o = order({ id: 1, amount: 500, pieces: 1, full: { day: '2026-11-04' } })
    expect(shippedBy(o, '2026-10-31', 'whole')).toBe(0)
    expect(build([o], []).whole.closing).toBe(0)
  })

  it('уехало без даты: отдельная строка периода запуска, в итог входит, до запуска не существует', () => {
    const o = order({ id: 1, amount: 500, pieces: 2, launchDay: '2026-10-05', full: { day: null } })
    const d = build([o], [])
    expect(d.whole.shipped).toBe(0)
    expect(d.whole.undated).toBe(500)
    expect(d.whole.closing).toBe(-500)
    expect(d.notes.undatedOrders).toBe(1)
    expect(shippedBy(o, '2026-10-01', 'whole')).toBe(0)
  })

  it('заказ закрыт отметкой поверх частей: по изделиям выходит вся сумма, без двойного счёта', () => {
    const o = order({ id: 1, full: { day: '2026-10-20' }, events: [{ day: '2026-10-10', amount: 400, pieces: 4 }] })
    const d = build([o], [])
    expect(d.items.shipped).toBe(1000)
    expect(d.items.shippedPieces).toBe(10)
    expect(d.whole.shipped).toBe(1000)
  })

  it('запущено за период: оплачено плюс не оплачено равно сумме; архив не считается', () => {
    const d = build([
      order({ id: 1, payments: [{ day: '2026-10-05', amount: 250 }] }),
      order({ id: 2, live: false, amount: 9999 }),
      order({ id: 3, launchDay: '2026-09-01', amount: 100 }),
    ], [])
    expect(d.launched.orders).toBe(1)
    expect(d.launched.amount).toBe(1000)
    expect(d.launched.paid).toBe(250)
    expect(d.launched.unpaid).toBe(750)
    expect(d.launched.openUnpaid).toBe(850)
  })

  it('заказ без движения и с нулевым долгом в список не идёт', () => {
    const quiet = order({ id: 1, launchDay: '2026-08-01', amount: 100, pieces: 1, full: { day: '2026-08-10' }, payments: [{ day: '2026-08-02', amount: 100 }] })
    expect(build([quiet], []).orders).toEqual([])
  })
})

describe('поступления', () => {
  it('сводятся по дням, итог тот же', () => {
    const d = build([], [{ day: '2026-10-09', amount: 100, source: 'bank' }, { day: '2026-10-09', amount: 50.5, source: 'bank' }, { day: '2026-10-02', amount: 7, source: 'bank' }])
    expect(d.moneyInPeriod.rows).toEqual([{ day: '2026-10-02', amount: 7, source: 'bank' }, { day: '2026-10-09', amount: 150.5, source: 'bank' }])
    expect(d.moneyInPeriod.total).toBe(157.5)
  })
})

describe('что считать деньгами', () => {
  const counts = (p: { source: string; method?: string; paid_at: string; linkedToBank?: boolean }) =>
    paymentCountsAsMoney({ linkedToBank: false, ...p }, '2026-09-01', '2026-10-30', isTransferMark)

  it('перевод, связанный с выпиской, считает сама выписка', () => {
    expect(counts({ source: 'bank_statement_import', method: 'Перевод', paid_at: '2026-10-09', linkedToBank: true })).toBe(false)
  })
  it('отметка внутри выписки денег не добавляет', () => {
    expect(counts({ source: 'b2b_order', method: 'Счёт', paid_at: '2026-10-14' })).toBe(false)
  })
  it('отметка до начала выписки и после её конца: другого следа нет, считаем', () => {
    expect(counts({ source: 'reconcile', method: 'Счёт', paid_at: '2026-04-09' })).toBe(true)
    expect(counts({ source: 'b2b_order', method: 'Счёт', paid_at: '2026-11-02' })).toBe(true)
  })
  it('наличные считаем всегда, списание с аванса — никогда', () => {
    expect(counts({ source: 'b2b_order', method: 'Наличные', paid_at: '2026-10-14' })).toBe(true)
    expect(counts({ source: 'client_advance', paid_at: '2026-10-14' })).toBe(false)
  })
})

describe('debtText', () => {
  it('называет, кто должен', () => {
    expect(debtText(100, 'Шовер Гласс')).toBe('Мы должны Шовер Гласс')
    expect(debtText(-100, 'Шовер Гласс')).toBe('Шовер Гласс должен нам')
    expect(debtText(0, 'Шовер Гласс')).toBe('Никто никому не должен')
  })
})
