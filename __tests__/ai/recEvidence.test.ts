import { describe, expect, it } from 'vitest'
import { pickEvidence, unverifiedNumbers } from '@/lib/ai/recEvidence'
import type { Fact } from '@/lib/ai/recommendationTypes'

const f = (id: string, value: number, unit: Fact['unit'] = 'count'): Fact => ({ id, label: id, value, unit, period: 'сентябрь 2026', source: 'тест' })
const facts = [
  f('sales.sum.last_month', 2_799_787, 'rub'), f('sales.sum.prev_month', 4_691_682, 'rub'),
  f('leads.qualified.30d', 119), f('leads.measure.30d', 5), f('margin.pct.q', 36.68, 'pct'),
]
const byId = new Map(facts.map(x => [x.id, x]))

describe('pickEvidence', () => {
  it('берёт известные id, check — из них, иначе первый', () => {
    expect(pickEvidence(['leads.measure.30d', 'нет.такого', 'leads.qualified.30d'], 'leads.qualified.30d', byId))
      .toMatchObject({ facts: [{ id: 'leads.measure.30d' }, { id: 'leads.qualified.30d' }], check: 'leads.qualified.30d' })
    expect(pickEvidence(['leads.measure.30d'], 'выдумка', byId)?.check).toBe('leads.measure.30d')
  })
  it('без опоры на данные — null', () => {
    expect(pickEvidence(['нет.такого'], null, byId)).toBeNull()
    expect(pickEvidence('leads.measure.30d', null, byId)).toBeNull()
  })
})

describe('unverifiedNumbers', () => {
  it('числа из данных, их доли и изменения — свои', () => {
    expect(unverifiedNumbers('Из 119 квалифицированных до замера дошло 5 (4,2%), маржа 36,7%.', facts)).toEqual([])
    expect(unverifiedNumbers('Продажи упали с 4,7 млн до 2 799 787 ₽ (−40%).', facts)).toEqual([])
  })
  it('сроки и годы не проверяем', () => {
    expect(unverifiedNumbers('За 30 дней в 2026 году, через 2 недели.', facts)).toEqual([])
  })
  it('выдуманное число помечается', () => {
    expect(unverifiedNumbers('Потеряно 80 заявок, конверсия 12%.', facts)).toEqual(['80', '12%'])
  })
})
