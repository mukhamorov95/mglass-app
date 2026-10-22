import { describe, it, expect } from 'vitest'
import { byMonth, moneyByMonth, totalsTo, sumTo, deltaPct, moneyCoveredTo, isClientIncome, isB2BSale, BOOK_END } from '@/lib/sales/dynamics'

const rows = [
  { date: '2025-01-10', amount: 100 }, { date: '2025-10-20', amount: 300 }, { date: '2025-10-25', amount: 50 },
  { date: '2025-12-31', amount: 1000 },
  { date: '2026-01-05', amount: 200 }, { date: '2026-10-22', amount: 400 }, { date: '2026-10-23', amount: 999 },
]

describe('динамика продаж по месяцам', () => {
  it('раскладывает суммы и количество по месяцам своего года', () => {
    const r = byMonth(rows, 2025)
    expect(r.sales[0]).toBe(100)
    expect(r.sales[9]).toBe(350)
    expect(r.count[9]).toBe(2)
    expect(r.sales[11]).toBe(1000)
    expect(r.sales.reduce((a, b) => a + b, 0)).toBe(1450)
  })

  it('итог года — одинаковое окно с 1 января по сегодняшнее число в обоих годах', () => {
    expect(totalsTo(rows, 2026, '10-22')).toEqual({ sales: 600, count: 2, avg: 300 })
    expect(totalsTo(rows, 2025, '10-22')).toEqual({ sales: 400, count: 2, avg: 200 })
    expect(totalsTo(rows, 2025, '12-31').count).toBe(4)
  })

  it('деньги после последнего известного дня — «нет данных», а не ноль', () => {
    const m = moneyByMonth([{ date: '2026-08-20', amount: 10 }, { date: '2026-09-02', amount: 5 }], 2026, '2026-08-25')
    expect(m[7]).toBe(10)
    expect(m[8]).toBeNull()
    expect(m[11]).toBeNull()
    expect(moneyByMonth([{ date: '2025-09-02', amount: 5 }], 2025, '2026-08-25')[8]).toBe(5)
    expect(sumTo([{ date: '2026-08-20', amount: 10 }, { date: '2025-09-01', amount: 7 }], 2025, '08-25')).toBe(0)
  })

  it('покрытие денег: книга до 25.08.2026, дальше — последняя выписка', () => {
    expect(moneyCoveredTo(null)).toBe(BOOK_END)
    expect(moneyCoveredTo('2026-10-21')).toBe('2026-10-21')
    expect(moneyCoveredTo('2026-08-01')).toBe(BOOK_END)
  })

  it('изменение к прошлому году; без базы — нет процента', () => {
    expect(deltaPct(150, 100)).toBe(50)
    expect(deltaPct(80, 100)).toBe(-20)
    expect(deltaPct(5, 0)).toBeNull()
  })

  it('в приход клиентов не идут переводы «со своих» и возвраты', () => {
    expect(isClientIncome('Безналичный Альфа ООО')).toBe(true)
    expect(isClientIncome(null)).toBe(true)
    expect(isClientIncome('со своих')).toBe(false)
    expect(isClientIncome('возвраты')).toBe(false)
  })

  it('просчёт B2B — не продажа; статус читается и с пробелом после двоеточия', () => {
    expect(isB2BSale('{"status":"quote"}')).toBe(false)
    expect(isB2BSale('{"status": "quote", "x": 1}')).toBe(false)
    expect(isB2BSale('{"status":"confirmed"}')).toBe(true)
    expect(isB2BSale({ status: 'pending_approval' })).toBe(false)
    expect(isB2BSale(null)).toBe(true)
  })
})
