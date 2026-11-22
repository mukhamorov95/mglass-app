import { describe, expect, it } from 'vitest'
import { aggregateWeeks, buildWeeks, delta, sourceOf, weekStart } from '@/lib/marketing/traffic'

describe('посещаемость по неделям чт–ср', () => {
  it('неделя начинается в четверг', () => {
    expect(weekStart('2026-11-19')).toBe('2026-11-19') // чт
    expect(weekStart('2026-11-22')).toBe('2026-11-19') // вс
    expect(weekStart('2026-11-25')).toBe('2026-11-19') // ср
    expect(weekStart('2026-11-26')).toBe('2026-11-26') // чт
  })

  it('полные недели и текущая неполная', () => {
    const w = buildWeeks('2026-11-22', 2)
    expect(w).toEqual([
      { from: '2026-11-05', to: '2026-11-11', partial: false },
      { from: '2026-11-12', to: '2026-11-18', partial: false },
      { from: '2026-11-19', to: '2026-11-22', partial: true },
    ])
    expect(buildWeeks('2026-11-25', 1).at(-1)).toEqual({ from: '2026-11-19', to: '2026-11-25', partial: false })
  })

  it('поиск Яндекс и Google отдельно, прочее по типу источника', () => {
    expect(sourceOf({ source: 'organic', engine: 'yandex' })).toBe('yandex')
    expect(sourceOf({ source: 'organic', engine: 'google' })).toBe('google')
    expect(sourceOf({ source: 'organic', engine: 'bing' })).toBe('otherSearch')
    expect(sourceOf({ source: 'messenger', engine: '' })).toBe('social')
    expect(sourceOf({ source: 'internal', engine: '' })).toBe('other')
  })

  it('визиты и заявки ложатся в свою неделю, сумма источников = визиты', () => {
    const weeks = buildWeeks('2026-11-22', 1)
    const rows = aggregateWeeks(weeks, [
      { date: '2026-11-18', source: 'organic', engine: 'yandex', visits: 3, pageviews: 5 },
      { date: '2026-11-19', source: 'organic', engine: 'google', visits: 2, pageviews: 2 },
      { date: '2026-11-19', source: 'direct', engine: '', visits: 4, pageviews: 9 },
      { date: '2026-11-01', source: 'direct', engine: '', visits: 100, pageviews: 100 },
    ], ['2026-11-12', '2026-11-20', '2026-11-21'])
    expect(rows[0]).toMatchObject({ visits: 3, yandex: 3, leads: 1 })
    expect(rows[1]).toMatchObject({ visits: 6, google: 2, direct: 4, leads: 2, pageviews: 11 })
    for (const r of rows) expect(r.yandex + r.google + r.otherSearch + r.direct + r.referral + r.social + r.ad + r.other).toBe(r.visits)
  })

  it('процент к прошлой неделе; от нуля — нет процента', () => {
    expect(delta(15, 10)).toBe(50)
    expect(delta(5, 0)).toBeNull()
  })
})

describe('покрытие недели счётчиками', () => {
  it('до первого дня счётчика — нет данных, неделя запуска — частично', async () => {
    const { coverage } = await import('@/lib/marketing/traffic')
    const w = (from: string, to: string) => ({ from, to, partial: false })
    expect(coverage(w('2026-09-24', '2026-09-30'), ['2026-10-05'])).toBe('none')
    expect(coverage(w('2026-10-01', '2026-10-07'), ['2026-10-05'])).toBe('partial')
    expect(coverage(w('2026-10-08', '2026-10-14'), ['2026-10-05', '2026-09-17'])).toBe('full')
    expect(coverage(w('2026-09-24', '2026-09-30'), ['2026-10-05', '2026-09-17'])).toBe('partial')
  })
})
