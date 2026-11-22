import { describe, it, expect } from 'vitest'
import {
  monthPeriods, workdays, splitKopecks, buildPeriodPlans, monthStatus, incomeSplit,
  finWeekOf, fundAvailability, type MonthPeriod, type FundLike,
} from '@/lib/finweek'

const sum = (a: number[]) => a.reduce((s, x) => s + x, 0)

describe('monthPeriods — месяц по датам операций, неделя целиком', () => {
  it('декабрь 2026: пять сред, последняя 30.12, затем «До конца месяца» 31.12', () => {
    const p = monthPeriods('2026-12')
    expect(p.map(x => [x.start, x.end, x.tail])).toEqual([
      ['2026-12-01', '2026-12-02', false],
      ['2026-12-03', '2026-12-09', false],
      ['2026-12-10', '2026-12-16', false],
      ['2026-12-17', '2026-12-23', false],
      ['2026-12-24', '2026-12-30', false],
      ['2026-12-31', '2026-12-31', true],
    ])
    expect(p[0].week).toEqual({ start: '2026-11-26', end: '2026-12-02' })
    expect(p[5].week).toEqual({ start: '2026-12-31', end: '2027-01-06' })
  })

  it('периоды покрывают каждый день месяца ровно один раз', () => {
    for (const ym of ['2026-02', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01']) {
      const p = monthPeriods(ym)
      expect(p[0].start).toBe(ym + '-01')
      for (let i = 1; i < p.length; i++) {
        const prev = Date.parse(p[i - 1].end + 'T00:00:00Z')
        expect(Date.parse(p[i].start + 'T00:00:00Z') - prev).toBe(86_400_000)
      }
    }
  })

  it('месяц, кончающийся в среду, хвоста не имеет (сентябрь 2026 — 30-е среда)', () => {
    const p = monthPeriods('2026-09')
    expect(p[p.length - 1]).toMatchObject({ end: '2026-09-30', tail: false })
  })
})

describe('приёмка №1: среда вечером и четверг утром — разные финнедели', () => {
  it('ср 25.11 закрывает неделю, чт 26.11 открывает следующую', () => {
    expect(finWeekOf('2026-11-25')).toEqual({ start: '2026-11-19', end: '2026-11-25' })
    expect(finWeekOf('2026-11-26')).toEqual({ start: '2026-11-26', end: '2026-12-02' })
  })
})

describe('приёмка №2: 500 000 от клиентов и 200 000 займа', () => {
  const LOAN = 9
  const entries = [
    { entry_date: '2026-11-20', kind: 'in', subfund_id: 1, amount: 500_000 },
    { entry_date: '2026-11-23', kind: 'in', subfund_id: LOAN, amount: 200_000 },
  ]
  it('на счетах +700 000, в план клиентских — 500 000', () => {
    const r = incomeSplit(entries, '2026-11-19', '2026-11-25', new Set([LOAN]))
    expect(r.client + r.nonIncome).toBe(700_000)
    expect(r.client).toBe(500_000)
    expect(r.nonIncome).toBe(200_000)
  })
  it('заём не наполняет фонды', () => {
    const funds: FundLike[] = [{ id: 1, name: 'Материал', fund_class: 'variable', percent: 40, sort: 1 }]
    const w = [{ start: '2026-11-19', end: '2026-11-25' }]
    const e = entries.map(x => ({ ...x, fund_id: 100 }))
    expect(fundAvailability(w, e, funds, new Set([LOAN])).get(1)?.allocated).toBe(200_000)
    expect(fundAvailability(w, e, funds).get(1)?.allocated).toBe(280_000)
  })
})

describe('приёмка №6: смена месяца посреди финнедели', () => {
  const entries = [
    { entry_date: '2026-10-30', kind: 'in', amount: 100_000 },
    { entry_date: '2026-11-02', kind: 'in', amount: 40_000 },
  ]
  const none = new Set<number>()
  it('неделя 29.10–04.11 включает все семь дней', () => {
    const w = finWeekOf('2026-10-30')
    expect(w).toEqual({ start: '2026-10-29', end: '2026-11-04' })
    expect(incomeSplit(entries, w.start, w.end, none).client).toBe(140_000)
  })
  it('октябрь берёт 30.10, ноябрь — 02.11, двойного учёта нет', () => {
    const oct = monthPeriods('2026-10').map(p => incomeSplit(entries, p.start, p.end, none).client)
    const nov = monthPeriods('2026-11').map(p => incomeSplit(entries, p.start, p.end, none).client)
    expect(sum(oct)).toBe(100_000)
    expect(sum(nov)).toBe(40_000)
    expect(monthPeriods('2026-10').at(-1)).toMatchObject({ start: '2026-10-29', end: '2026-10-31', tail: true })
  })
})

describe('splitKopecks — разбивка до копейки', () => {
  it('недозаполнение 140 255 ₽ на три недели: 46 751,67 + 46 751,67 + 46 751,66', () => {
    expect(splitKopecks(14_025_500, [1, 1, 1])).toEqual([4_675_167, 4_675_167, 4_675_166])
  })
  it('сумма частей всегда равна целому', () => {
    for (const t of [1, 99, 100_000_01, 2_000_000_00]) {
      expect(sum(splitKopecks(t, [3, 5, 5, 5, 2]))).toBe(t)
    }
  })
  it('нулевые веса — поровну', () => {
    expect(splitKopecks(300, [0, 0, 0])).toEqual([100, 100, 100])
  })
})

describe('workdays', () => {
  it('пн–пт без федеральных праздников', () => {
    expect(workdays('2026-11-02', '2026-11-08')).toBe(4) // 04.11 — праздник
    expect(workdays('2027-01-01', '2027-01-06')).toBe(0)
  })
})

describe('buildPeriodPlans — пример ТЗ: 2 000 000, четыре равных периода, к второй среде 880 000', () => {
  const P = (start: string, end: string): MonthPeriod => ({ start, end, week: { start, end }, tail: false })
  const periods = [P('2026-09-03', '2026-09-09'), P('2026-09-10', '2026-09-16'), P('2026-09-17', '2026-09-23'), P('2026-09-24', '2026-09-30')]
  const rows = buildPeriodPlans(2_000_000, periods, [440_000, 440_000, 0, 0], '2026-09-17')
  const st = monthStatus(rows, 2_000_000)

  it('исходный план периода — 500 000', () => {
    expect(rows.map(r => r.base)).toEqual([500_000, 500_000, 500_000, 500_000])
  })
  it('на конец второй среды: должно было 1 000 000, пришло 880 000, отставание 120 000', () => {
    expect(st).toMatchObject({ asOf: '2026-09-16', cumBase: 1_000_000, cumFact: 880_000, lag: 120_000, remaining: 1_120_000 })
  })
  it('новая цель на каждый из двух оставшихся периодов — 560 000', () => {
    expect(st.nextTargets).toEqual([560_000, 560_000])
  })
  it('исходный план сохраняется рядом с пересмотренным', () => {
    expect(rows[2]).toMatchObject({ base: 500_000, plan: 560_000 })
  })
  it('перевыполнение месяца не даёт отрицательных целей', () => {
    const r = buildPeriodPlans(1_000_000, periods, [1_200_000, 0, 0, 0], '2026-09-10')
    expect(r.slice(1).map(x => x.plan)).toEqual([0, 0, 0])
  })
  it('разбивка реального месяца по рабочим дням сходится до копейки', () => {
    const r = buildPeriodPlans(2_302_632.37, monthPeriods('2026-12'), [], '2026-11-30')
    expect(Math.round(sum(r.map(x => x.base)) * 100)).toBe(230_263_237)
    expect(r.at(-1)?.base).toBeGreaterThan(0) // 31.12 — рабочий четверг
  })
})
