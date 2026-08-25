import { describe, it, expect } from 'vitest'
import { buildYear, usnDues, ipContributions, vatDues } from '@/lib/taxCalendar'

describe('налоговый календарь', () => {
  it('авансы УСН — 28-е число месяца после квартала', () => {
    const d = usnDues(2026, false).map(x => x.dueDate)
    expect(d[0]).toBe('2026-04-28')
    expect(d[1]).toBe('2026-07-28')
    expect(d[2]).toBe('2026-10-28')
  })

  it('годовой УСН: ООО — март, ИП — апрель следующего года', () => {
    expect(usnDues(2026, true).at(-1)!.dueDate.slice(0, 7)).toBe('2027-03')
    expect(usnDues(2026, false).at(-1)!.dueDate.slice(0, 7)).toBe('2027-04')
  })

  it('срок с выходного переносится вперёд на понедельник', () => {
    // 28.03.2027 — воскресенье
    expect(usnDues(2026, true).at(-1)!.dueDate).toBe('2027-03-29')
  })

  it('взносы ИП: фиксированные в декабре, 1% — 1 июля следующего года', () => {
    const [fixed, onePercent] = ipContributions(2026)
    expect(fixed.dueDate).toBe('2026-12-28')
    expect(onePercent.dueDate).toBe('2027-07-01')   // 1% за 2026 год платится до 1 июля 2027
    expect(onePercent.period).toBe('2026 год')
  })

  it('НДС — три равные части в следующем квартале', () => {
    const q4 = vatDues(2026).filter(d => d.period.startsWith('4 квартал'))
    expect(q4).toHaveLength(3)
    // 28.02.2027 и 28.03.2027 — воскресенья, оба срока переезжают на понедельник
    expect(q4.map(d => d.dueDate)).toEqual(['2027-01-28', '2027-03-01', '2027-03-29'])
  })

  it('набор ИП с сотрудниками отсортирован по дате и содержит НДФЛ', () => {
    const all = buildYear(2026, 'usn', { company: false, hasStaff: true })
    expect(all.some(d => d.kind === 'НДФЛ')).toBe(true)
    expect(all.some(d => d.kind === 'взносы')).toBe(true)
    const dates = all.map(d => d.dueDate)
    expect([...dates].sort()).toEqual(dates)
  })
})
