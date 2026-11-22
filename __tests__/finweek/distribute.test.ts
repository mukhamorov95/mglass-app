import { describe, it, expect } from 'vitest'
import { distributeMonth, allocatedByFund, type DistFund } from '@/lib/finplan/distribute'

const W = ['2026-12-02', '2026-12-09', '2026-12-16', '2026-12-23']
const weeks = (inc: number[]) => W.map((week_end, i) => ({ week_end, income: inc[i] ?? 0 }))
const F = (o: Partial<DistFund> & { id: number }): DistFund => ({ name: `ф${o.id}`, fund_class: 'fixed', percent: null, sort: o.id, monthlyNeed: null, ...o })

describe('заливка фондов по методике (ТЗ §7)', () => {
  const funds = [
    F({ id: 1, fund_class: 'variable', percent: 40 }),
    F({ id: 2, fund_class: 'fund', percent: 5 }),
    F({ id: 3, monthlyNeed: 800_000 }),           // постоянный: 200 000 в неделю
    F({ id: 4, monthlyNeed: 400_000 }),           // 100 000 в неделю
    F({ id: 5, fund_class: 'fund', percent: 0, sort: 99 }), // последний фонд модели
  ]

  it('переменные и фонды из маржи — % от денег клиентов, затем постоянные по очереди', () => {
    const d = distributeMonth(weeks([600_000, 0, 0, 0]), funds)[0]
    const by = new Map(d.rows.map(x => [x.fund_id, x]))
    expect(by.get(1)!.allocated).toBe(240_000)
    expect(by.get(2)!.allocated).toBe(30_000)
    expect(by.get(3)).toMatchObject({ plan: 200_000, allocated: 230_000, short: 0, advance: 30_000 }) // своя потребность + опережение
    expect(by.get(4)).toMatchObject({ plan: 100_000, allocated: 100_000, short: 0 })
    expect(d.overflow).toBe(0)
    // 600 000 − 240 000 − 30 000 − 300 000 = 30 000 → опережение фонду 3 на следующую неделю
    expect(d.pointer).toEqual({ week_end: '2026-12-09', fund_id: 3 })
  })

  it('пример ТЗ: недозаполнение 140 255 ₽ на три оставшиеся недели — 46 751,67 + 46 751,67 + 46 751,66', () => {
    // остаток после переменных и маржи: 300 000 × 0,55 = 165 000; фонду 3 нужно 200 000 → нехватка 35 000… подберём ровно
    const inc = (200_000 - 140_255) / 0.55
    const d = distributeMonth(weeks([inc, 5_000_000, 5_000_000, 5_000_000]), funds)
    expect(d[0].rows.find(x => x.fund_id === 3)!.short).toBe(140_255)
    expect(d[0].rows.find(x => x.fund_id === 4)!.allocated).toBe(0)
    expect(d.slice(1).map(w => w.rows.find(x => x.fund_id === 3)!.plan)).toEqual([246_751.67, 246_751.67, 246_751.66])
  })

  it('после нехватки следующая неделя снова начинает с первого фонда', () => {
    const d = distributeMonth(weeks([100_000, 1_000_000, 0, 0]), funds)
    const w2 = new Map(d[1].rows.map(x => [x.fund_id, x]))
    expect(w2.get(3)!.short).toBe(0)
    expect(w2.get(4)!.short).toBe(0)
  })

  it('после выполнения месячного плана избыток — в последний фонд модели', () => {
    const d = distributeMonth(weeks([10_000_000, 0, 0, 0]), funds)
    const last = d[0].rows.find(x => x.fund_id === 5)!
    // 10 млн × 0,55 = 5,5 млн; потребность месяца постоянных 1,2 млн → 4,3 млн в последний фонд
    expect(d[0].overflow).toBe(4_300_000)
    expect(last.allocated).toBe(4_300_000)
    const total = [...allocatedByFund(d).values()].reduce((s, x) => s + x, 0)
    expect(Math.round(total * 100)).toBe(1_000_000_000)
  })

  it('сумма распределённого никогда не больше денег недели', () => {
    for (const inc of [0, 1, 99_999.99, 512_345.67, 3_000_000]) {
      const d = distributeMonth(weeks([inc, inc, inc, inc]), funds)
      for (const w of d) expect(Math.round(w.rows.reduce((s, x) => s + x.allocated, 0) * 100)).toBeLessThanOrEqual(Math.round(w.income * 100))
    }
  })

  it('отрицательный % в модели — ноль и пометка', () => {
    const d = distributeMonth(weeks([100_000]), [F({ id: 9, percent: -0.262 }), F({ id: 10, fund_class: 'fund', percent: 0, sort: 99 })])
    expect(d[0].rows.find(x => x.fund_id === 9)).toMatchObject({ allocated: 0, badPercent: true })
  })
})
