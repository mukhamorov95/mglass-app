import { describe, it, expect } from 'vitest'
import { resolvePeriod, parseManagers, shiftMonth, monthLabel, dayLabel } from '@/lib/sales/period'

const TODAY = '2026-09-17'

describe('период реестра продаж', () => {
  it('по умолчанию — текущий месяц, верхняя граница исключающая', () => {
    const p = resolvePeriod({}, TODAY)
    expect(p).toMatchObject({ mode: 'month', from: '2026-09-01', to: '2026-09-30', toExclusive: '2026-10-01', month: '2026-09' })
    expect(p.label).toBe('Сентябрь 2026')
  })

  it('декабрь закрывается следующим годом, а не 13-м месяцем', () => {
    expect(resolvePeriod({ month: '2026-12' }, TODAY)).toMatchObject({ to: '2026-12-31', toExclusive: '2027-01-01' })
  })

  it('февраль високосного года — 29 дней', () => {
    expect(resolvePeriod({ month: '2028-02' }, TODAY).to).toBe('2028-02-29')
  })

  it('квартал берётся по месяцу, год — по его году', () => {
    expect(resolvePeriod({ month: '2026-09', mode: 'quarter' }, TODAY))
      .toMatchObject({ from: '2026-07-01', to: '2026-09-30', toExclusive: '2026-10-01', label: '3 квартал 2026' })
    expect(resolvePeriod({ month: '2026-11', mode: 'quarter' }, TODAY))
      .toMatchObject({ from: '2026-10-01', to: '2026-12-31', toExclusive: '2027-01-01' })
    expect(resolvePeriod({ month: '2026-03', mode: 'year' }, TODAY))
      .toMatchObject({ from: '2026-01-01', to: '2026-12-31', toExclusive: '2027-01-01', label: '2026 год' })
  })

  it('произвольные даты бьют режим, перепутанные местами разворачиваются', () => {
    const p = resolvePeriod({ from: '2026-08-20', to: '2026-07-01', mode: 'year' }, TODAY)
    expect(p).toMatchObject({ mode: 'range', from: '2026-07-01', to: '2026-08-20', toExclusive: '2026-08-21' })
    expect(p.label).toBe('1 июля 2026 — 20 августа 2026')
  })

  it('мусор в параметрах не роняет период', () => {
    expect(resolvePeriod({ month: '2026-13' }, TODAY).month).toBe('2026-09')
    expect(resolvePeriod({ from: 'вчера', to: '' }, TODAY).mode).toBe('month')
  })

  it('стрелки месяцев переходят через год', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(monthLabel('2026-01')).toBe('Январь 2026')
    expect(dayLabel('2026-09-01')).toBe('1 сентября 2026')
  })

  it('пустой фильтр менеджеров = все, дубли схлопываются', () => {
    expect(parseManagers(null)).toEqual([])
    expect(parseManagers('')).toEqual([])
    expect(parseManagers('Яна, Семён ,Яна')).toEqual(['Яна', 'Семён'])
  })
})
