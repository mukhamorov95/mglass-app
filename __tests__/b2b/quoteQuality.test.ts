import { describe, it, expect } from 'vitest'
import {
  groupsFieldExisted, managersInPeriod, pct, pivotByManager, pivotByWeek, sumTotals,
  type QualityRow,
} from '@/lib/b2b/quoteQuality'

const row = (week: string, manager: string, p: Partial<QualityRow> = {}): QualityRow => ({
  week, manager, positions: 0, flagged: 0, detailed: 0, diam_in_comment: 0, cutouts: 0, orders: 0, ...p,
})

describe('доля', () => {
  it('делит и округляет', () => {
    expect(pct(9, 242)).toBe(4)
    expect(pct(1, 2)).toBe(50)
  })

  it('на нулевом знаменателе возвращает null, а не ноль процентов', () => {
    // Экран печатает «—»: делить не на что — это не «ноль процентов»,
    // иначе неделя без просчётов читается как провал менеджера.
    expect(pct(0, 0)).toBeNull()
    expect(pct(5, 0)).toBeNull()
  })
})

describe('поле групп ⌀ выкачено 28.08', () => {
  it('неделя, закончившаяся до выката, помечается как «поля ещё не было»', () => {
    expect(groupsFieldExisted('2026-08-17')).toBe(false)   // 17–23.08
  })

  it('неделя, захватившая день выката, уже считается', () => {
    expect(groupsFieldExisted('2026-08-24')).toBe(true)    // 24–30.08, выкат 28.08
    expect(groupsFieldExisted('2026-08-31')).toBe(true)
  })
})

describe('свод', () => {
  const rows = [
    row('2026-08-24', 'Нуржан', { positions: 93, flagged: 9, diam_in_comment: 7, orders: 34 }),
    row('2026-08-24', 'Вера',   { positions: 23, orders: 9 }),
    row('2026-08-31', 'Нуржан', { positions: 78, flagged: 10, detailed: 2, diam_in_comment: 4, orders: 15 }),
  ]

  it('складывает период', () => {
    expect(sumTotals(rows)).toMatchObject({ positions: 194, flagged: 19, detailed: 2, diam_in_comment: 11 })
  })

  it('менеджеры отсортированы по объёму просчётов', () => {
    expect(managersInPeriod(rows)).toEqual(['Нуржан', 'Вера'])
  })

  it('недели идут сверху вниз от свежей', () => {
    expect(pivotByWeek(rows, managersInPeriod(rows)).map(w => w.week)).toEqual(['2026-08-31', '2026-08-24'])
  })

  it('менеджер без просчётов на неделе — null, а не ноль', () => {
    // Ноль читался бы как «считал и не отметил ни разу». Это разные состояния,
    // и на экране они должны выглядеть по-разному.
    const [fresh] = pivotByWeek(rows, managersInPeriod(rows))
    expect(fresh.byManager['Вера']).toBeNull()
    expect(fresh.byManager['Нуржан']).toMatchObject({ positions: 78 })
  })

  it('по менеджеру за период — сумма его недель', () => {
    const [top] = pivotByManager(rows)
    expect(top).toMatchObject({ manager: 'Нуржан', total: { positions: 171, flagged: 19, detailed: 2 } })
  })
})
