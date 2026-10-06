import { describe, it, expect } from 'vitest'
import { foldStats, splitPeriod, describeNote, dayLedger, type StatFact } from '@/lib/sales/managerStats'

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

  it('доля назначенных замеров — от разговоров, без разговоров «—», а не ∞', () => {
    const { rows } = foldStats(FACTS)
    expect(rows[0].toMeasure).toBe(3)
    expect(rows[1].toMeasure).toBe(0)   // 94 разговора и ни одного замера — это ноль, а не «нет данных»
    const vlad = foldStats([f('Влад', 'measure_assigned', 1), f('Влад', 'payments', 3)]).rows[0]
    expect(vlad.toMeasure).toBeNull()   // разговоров в книге нет — делить не на что
  })

  it('«назначен → проведён» и «проведён → оплата» не считаются: счётчики месяца из разных когорт', () => {
    // Айжан, сентябрь 2026 в книге: оплаты шли и по замерам августа, доля вышла бы 250 %.
    const { rows, totals } = foldStats([
      f('Айжан', 'talks', 62), f('Айжан', 'measure_assigned', 5),
      f('Айжан', 'measure_done', 2), f('Айжан', 'payments', 5),
    ])
    for (const r of [rows[0], totals]) {
      expect(r).not.toHaveProperty('toDone')
      expect(r).not.toHaveProperty('toPayment')
      expect(r.toMeasure).toBe(8)
    }
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


describe('период для показателей: целые месяцы из итога книги, хвосты — по дням', () => {
  it('целый месяц и квартал — только итоги месяцев, без дней', () => {
    expect(splitPeriod('2026-08-01', '2026-08-31')).toEqual({ months: ['2026-08'], dayRanges: [] })
    expect(splitPeriod('2026-07-01', '2026-09-30')).toEqual({ months: ['2026-07', '2026-08', '2026-09'], dayRanges: [] })
  })

  it('период режет месяцы — края по дням, середина итогами', () => {
    expect(splitPeriod('2026-07-15', '2026-09-10')).toEqual({
      months: ['2026-08'],
      dayRanges: [['2026-07-15', '2026-07-31'], ['2026-09-01', '2026-09-10']],
    })
  })

  it('внутри одного месяца — только дни', () => {
    expect(splitPeriod('2026-02-03', '2026-02-20')).toEqual({ months: [], dayRanges: [['2026-02-03', '2026-02-20']] })
  })

  it('февраль високосного и переход года', () => {
    expect(splitPeriod('2028-02-01', '2028-02-29').months).toEqual(['2028-02'])
    expect(splitPeriod('2025-12-01', '2026-01-31').months).toEqual(['2025-12', '2026-01'])
  })

  it('подпись расхождения называет день, который книга потеряла', () => {
    expect(describeNote({ month: '2025-07', manager: 'Яна', metric: 'prepay', book: 1405965, days: 1426260, value: 1426260, kind: 'total_misses_last_day', note_day: '2025-07-31' }))
      .toContain('31.07.2025')
  })
})

describe('dayLedger', () => {
  const f = (stat_date: string, metric: string, value: number) => ({ stat_date, manager: 'Яна', metric, value })

  it('дни с деньгами по порядку; разговоры и нули не попадают', () => {
    const lines = dayLedger([
      f('2026-06-15', 'prepay', 100_000), f('2026-06-15', 'money_total', 100_000), f('2026-06-15', 'payments', 1),
      f('2026-06-03', 'remainder', 40_000), f('2026-06-03', 'money_total', 40_000),
      f('2026-06-04', 'talks', 12), f('2026-06-05', 'prepay', 0),
    ], [], [])
    expect(lines.map(l => l.date)).toEqual(['2026-06-03', '2026-06-15'])
    expect(lines[1]).toMatchObject({ payments: 1, prepay: 100_000, remainder: 0, money_total: 100_000 })
  })

  it('целый месяц: сумма без дня отдельной строкой, и список складывается в итог месяца', () => {
    const days = [f('2026-06-10', 'remainder', 20_000), f('2026-06-10', 'money_total', 20_000)]
    const totals = [
      { month: '2026-06', metric: 'remainder', value: 70_794 },
      { month: '2026-06', metric: 'money_total', value: 70_794 },
      { month: '2026-06', metric: 'payments', value: 6 },
      { month: '2026-06', metric: 'prepay', value: 0 },
    ]
    const lines = dayLedger(days, totals, ['2026-06'])
    expect(lines.at(-1)).toEqual({ date: null, month: '2026-06', payments: 6, prepay: 0, remainder: 50_794, money_total: 50_794 })
    for (const t of totals) expect(lines.reduce((a, l) => a + l[t.metric as 'prepay'], 0)).toBe(t.value)
  })

  it('итог месяца равен дням — строки «без дня» нет', () => {
    const lines = dayLedger([f('2026-07-01', 'prepay', 5_000)], [{ month: '2026-07', metric: 'prepay', value: 5_000 }], ['2026-07'])
    expect(lines).toHaveLength(1)
  })

  it('месяцы по порядку, «без дня» в конце своего месяца', () => {
    const lines = dayLedger(
      [f('2026-02-20', 'prepay', 1), f('2026-03-02', 'prepay', 1)],
      [{ month: '2026-02', metric: 'prepay', value: 5 }],
      ['2026-02'],
    )
    expect(lines.map(l => l.date)).toEqual(['2026-02-20', null, '2026-03-02'])
  })
})
