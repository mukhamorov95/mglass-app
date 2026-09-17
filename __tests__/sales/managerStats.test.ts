import { describe, it, expect } from 'vitest'
import { foldStats, type StatFact } from '@/lib/sales/managerStats'

const f = (manager: string, metric: string, value: number, stat_date = '2026-09-01'): StatFact =>
  ({ manager, metric, value, stat_date })

const FACTS: StatFact[] = [
  f('Александра', 'talks', 234), f('Александра', 'measure_assigned', 7), f('Александра', 'measure_done', 7),
  f('Александра', 'payments', 5), f('Александра', 'prepay', 368857), f('Александра', 'remainder', 75520),
  f('Александра', 'money_total', 444377),
  f('Яна', 'talks', 94, '2026-09-02'), f('Яна', 'payments', 2, '2026-09-02'),
  f('Яна', 'prepay', 162505, '2026-09-02'), f('Яна', 'remainder', 180675, '2026-09-02'),
  f('Яна', 'money_total', 343180, '2026-09-02'),
]

describe('свод показателей менеджеров', () => {
  it('складывает по менеджеру, сортирует по деньгам', () => {
    const { rows, days } = foldStats(FACTS)
    expect(rows.map(r => r.manager)).toEqual(['Александра', 'Яна'])
    expect(rows[0]).toMatchObject({ talks: 234, payments: 5, prepay: 368857, money_total: 444377 })
    expect(days).toBe(2)
  })

  it('«всего» из книги сверяется с суммой предоплат и остатков', () => {
    const { rows } = foldStats(FACTS)
    expect(rows[0].moneySum).toBe(444377)
    expect(rows[0].moneyGap).toBe(0)
    const gap = foldStats([...FACTS, f('Айжан', 'prepay', 100), f('Айжан', 'money_total', 90)])
    expect(gap.rows.find(r => r.manager === 'Айжан')).toMatchObject({ moneySum: 100, moneyGap: -10 })
  })

  it('конверсии считаются по своим базам, деление на ноль даёт «—», а не ∞', () => {
    const { rows } = foldStats(FACTS)
    expect(rows[0]).toMatchObject({ toMeasure: 3, toDone: 100, toPayment: 71 })
    const yana = rows[1]
    expect(yana.toMeasure).toBe(0)      // 94 разговора и ни одного замера — это ноль, а не «нет данных»
    expect(yana.toDone).toBeNull()      // назначенных не было — делить не на что
    expect(yana.toPayment).toBeNull()   // проведённых не было — конверсии нет
  })

  it('итог сходится со строками, средний чек — из предоплат на оплату', () => {
    const { rows, totals } = foldStats(FACTS)
    expect(totals.money_total).toBe(rows.reduce((s, r) => s + r.money_total, 0))
    expect(totals.talks).toBe(328)
    expect(totals.payments).toBe(7)
    expect(totals.avgCheck).toBe(Math.round((368857 + 162505) / 7))
  })

  it('фильтр по менеджерам оставляет только выбранных', () => {
    const { rows, totals } = foldStats(FACTS, ['Яна'])
    expect(rows).toHaveLength(1)
    expect(totals.money_total).toBe(343180)
  })

  it('чужой показатель из книги в свод не попадает', () => {
    const { rows } = foldStats([...FACTS, f('Александра', 'стоимость привлечения', 999)])
    expect(rows[0].money_total).toBe(444377)
  })
})
