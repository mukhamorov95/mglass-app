import { describe, it, expect } from 'vitest'
import { finWeeksOfMonth, finWeekOf, buildWeekPlans, waterfall, fundAvailability, type FundLike } from '@/lib/finweek'

describe('finWeeksOfMonth', () => {
  it('июль 2026: пять четвергов → пять недель чт–ср', () => {
    const w = finWeeksOfMonth('2026-07')
    expect(w).toHaveLength(5)
    expect(w[0]).toEqual({ start: '2026-07-02', end: '2026-07-08' })
    expect(w[4]).toEqual({ start: '2026-07-30', end: '2026-08-05' }) // хвост уходит в август
  })

  it('август 2026: первые дни месяца принадлежат последней неделе июля', () => {
    const w = finWeeksOfMonth('2026-08')
    expect(w[0].start).toBe('2026-08-06') // 1–5 августа — в неделе от 30 июля
    expect(w).toHaveLength(4)
  })

  it('февраль 2026 (невисокосный)', () => {
    const w = finWeeksOfMonth('2026-02')
    expect(w).toHaveLength(4)
    expect(w[0].start).toBe('2026-02-05')
    expect(w[3].end).toBe('2026-03-04')
  })
})

describe('finWeekOf', () => {
  it('понедельник попадает в неделю прошлого четверга', () => {
    expect(finWeekOf('2026-07-20')).toEqual({ start: '2026-07-16', end: '2026-07-22' })
  })
  it('четверг начинает свою неделю', () => {
    expect(finWeekOf('2026-07-16')).toEqual({ start: '2026-07-16', end: '2026-07-22' })
  })
  it('среда завершает неделю прошлого четверга', () => {
    expect(finWeekOf('2026-07-15')).toEqual({ start: '2026-07-09', end: '2026-07-15' })
  })
})

describe('buildWeekPlans — правило владельца о пересчёте', () => {
  const weeks = finWeeksOfMonth('2026-08') // 4 недели
  it('без факта план делится поровну', () => {
    const p = buildWeekPlans(4_000_000, weeks, [], '2026-08-01')
    expect(p.map(x => x.plan)).toEqual([1_000_000, 1_000_000, 1_000_000, 1_000_000])
    expect(p.every(x => !x.completed)).toBe(true)
  })
  it('недобор завершённой недели ДОБАВЛЯЕТСЯ поровну к оставшимся', () => {
    // Неделя 1 (6–12 авг) недобрала 300к → по +100к на недели 2–4
    const p = buildWeekPlans(4_000_000, weeks, [700_000], '2026-08-14')
    expect(p[0].deviation).toBe(-300_000)
    expect(p[1].plan).toBe(1_100_000)
    expect(p[3].plan).toBe(1_100_000)
  })
  it('перевыполнение — вычитается из оставшихся', () => {
    const p = buildWeekPlans(4_000_000, weeks, [1_600_000], '2026-08-14')
    expect(p[1].plan).toBe(800_000)
  })
  it('пересчёт каскадный: вторая неделя пересчитывается от уже скорректированного плана', () => {
    // нед.1 факт 700к (недобор 300к → нед.2-4 план 1.1м);
    // нед.2 факт 800к (недобор 300к от 1.1м → нед.3-4 по +150к)
    const p = buildWeekPlans(4_000_000, weeks, [700_000, 800_000], '2026-08-21')
    expect(p[2].plan).toBe(1_250_000)
    expect(p[3].plan).toBe(1_250_000)
  })
  it('текущая неделя помечена и не триггерит пересчёт', () => {
    const p = buildWeekPlans(4_000_000, weeks, [700_000, 500_000], '2026-08-15') // суббота 2-й недели
    expect(p[1].current).toBe(true)
    expect(p[1].completed).toBe(false)
    expect(p[2].plan).toBe(1_100_000) // только недобор недели 1
  })
  it('сумма скорректированных планов всегда равна месячному плану', () => {
    const p = buildWeekPlans(4_000_000, weeks, [700_000, 1_600_000, 100_000], '2026-09-02')
    const factSoFar = 700_000 + 1_600_000 + 100_000
    const lastPlan = p[3].plan
    expect(Math.round(factSoFar + lastPlan)).toBe(4_000_000)
  })
})

const FUNDS: FundLike[] = [
  { id: 1, name: 'Закуп стекла', fund_class: 'variable', percent: 30, sort: 1 },
  { id: 2, name: 'ФОТ цеха', fund_class: 'variable', percent: 20, sort: 2 },
  { id: 3, name: 'Аренда', fund_class: 'fixed', percent: 25, sort: 1 },
  { id: 4, name: 'Резервный фонд', fund_class: 'fund', percent: 15, sort: 1 },
  { id: 5, name: 'Поступления', fund_class: 'income', percent: null, sort: 0 },
  { id: 6, name: 'Без процента', fund_class: 'fixed', percent: null, sort: 9 },
]

describe('waterfall — наполнение сверху вниз', () => {
  it('при достатке все фонды получают свой процент, остаток — перелив', () => {
    const { fills, overflow } = waterfall(1_000_000, FUNDS)
    expect(fills.map(f => f.id)).toEqual([1, 2, 3, 4]) // income и без-процента исключены
    expect(fills[0].allocated).toBe(300_000)
    expect(fills[3].allocated).toBe(150_000)
    expect(overflow).toBe(100_000) // 100% − 90%
  })
  it('при нехватке нижние фонды не наполняются (сверху вниз)', () => {
    // проценты суммарно 90%, но верхний фонд 30% — если процентов больше 100,
    // нижним не хватает; смоделируем: урежем доход так, чтобы pool кончился
    const tight: FundLike[] = FUNDS.map(f => f.id === 1 ? { ...f, percent: 80 } : f)
    const { fills, overflow } = waterfall(1_000_000, tight)
    expect(fills[0].allocated).toBe(800_000) // переменные забрали первыми
    expect(fills[1].allocated).toBe(200_000) // 20% = 200к, хватило
    expect(fills[2].allocated).toBe(0)       // аренде не хватило
    expect(fills[3].allocated).toBe(0)
    expect(overflow).toBe(0)
  })
  it('нулевой и отрицательный доход не ломают расчёт', () => {
    expect(waterfall(0, FUNDS).overflow).toBe(0)
    expect(waterfall(-5, FUNDS).fills.every(f => f.allocated === 0)).toBe(true)
  })
})

describe('fundAvailability — точный остаток фонда по неделям', () => {
  const weeks = finWeeksOfMonth('2026-07')
  it('аллокации считаются понедельно, расходы вычитаются', () => {
    const entries = [
      { entry_date: '2026-07-03', kind: 'in', fund_id: 5, amount: 1_000_000 },  // неделя 1
      { entry_date: '2026-07-10', kind: 'in', fund_id: 5, amount: 500_000 },    // неделя 2
      { entry_date: '2026-07-11', kind: 'out', fund_id: 3, amount: 100_000 },   // аренда
      { entry_date: '2026-06-01', kind: 'in', fund_id: 5, amount: 999_999 },    // вне месяца — мимо
    ]
    const avail = fundAvailability(weeks, entries, FUNDS)
    expect(avail.get(3)!.allocated).toBe(375_000) // 25% × (1м + 500к)
    expect(avail.get(3)!.spent).toBe(100_000)
    expect(avail.get(3)!.available).toBe(275_000)
  })
  it('расход в хвосте последней недели (начало августа) учитывается в июле', () => {
    const entries = [
      { entry_date: '2026-07-31', kind: 'in', fund_id: 5, amount: 400_000 },
      { entry_date: '2026-08-03', kind: 'out', fund_id: 1, amount: 50_000 }, // в неделе 30.07–05.08
    ]
    const avail = fundAvailability(weeks, entries, FUNDS)
    expect(avail.get(1)!.allocated).toBe(120_000)
    expect(avail.get(1)!.spent).toBe(50_000)
  })
})
