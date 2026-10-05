import { describe, it, expect } from 'vitest'
import { defaultSince, formatManagerStatsReport, missingKeys, type ManagerStatsReport } from '@/lib/sales/managerStatsSync'

describe('managerStatsSync — книга «Аналитика дохода» как зеркало', () => {
  it('по умолчанию сверяет с начала прошлого месяца', () => {
    expect(defaultSince('2026-10-05')).toBe('2026-09-01')
    expect(defaultSince('2026-01-15')).toBe('2025-12-01')
  })

  it('значение, которого в книге больше нет, находится — его обнулят, а не оставят старым', () => {
    const key = (f: { stat_date: string; manager: string; metric: string }) => `${f.stat_date}|${f.manager}|${f.metric}`
    const db = [
      { stat_date: '2026-09-30', manager: 'Яна', metric: 'prepay', value: 94500 },
      { stat_date: '2026-09-29', manager: 'Яна', metric: 'talks', value: 10 },
    ]
    const book = [{ stat_date: '2026-09-30', manager: 'Яна', metric: 'prepay', value: 94500 }]
    expect(missingKeys(db, book, key)).toEqual([db[1]])
  })

  const base: ManagerStatsReport = {
    dry: false, since: '2026-09-01', facts: 216, months: 29, zeroed: { days: 0, months: 0 },
    lastDay: '2026-10-04', lastDayByManager: {}, unknown: [], odd: [],
  }

  it('всё в порядке — владельцу ничего не пишем', () => {
    expect(formatManagerStatsReport(base, '2026-10-06')).toBeNull()
  })

  it('книга отстала больше чем на три дня — говорим, по какую дату видны деньги', () => {
    const text = formatManagerStatsReport({ ...base, lastDay: '2026-09-30' }, '2026-10-05')
    expect(text).toContain('Книга заполнена по 30.09')
  })

  it('выходные не считаются отставанием: в понедельник книга по пятницу — молчим', () => {
    expect(formatManagerStatsReport({ ...base, lastDay: '2026-10-02' }, '2026-10-05')).toBeNull()
  })

  it('предохранитель и ошибка записи видны владельцу', () => {
    expect(formatManagerStatsReport({ ...base, held: 'в книге 3 значения' }, '2026-10-06')).toContain('⏸ в книге 3 значения')
    expect(formatManagerStatsReport({ ...base, error: 'запись дней: timeout' }, '2026-10-06')).toContain('⚠️ запись дней')
  })
})
