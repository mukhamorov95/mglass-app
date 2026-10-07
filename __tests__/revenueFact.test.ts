import { describe, it, expect } from 'vitest'
import { monthRevenueFact, factMonthStart } from '@/lib/cfo/revenueFact'
import type { SourceDiag } from '@/lib/cfo/sourceDiagnostics'

const diag = (o: Partial<SourceDiag>): SourceDiag => ({
  unit: 'Производство', source: 's', table: 't', records: 1, sumRub: 0, periodFrom: null, periodTo: null,
  issue: '', verdict: 'trust', reason: '', usedForFact: true, ...o,
})

describe('выручка месяца одной цифрой', () => {
  it('складывает только доверенные источники, помеченные для факта', () => {
    const f = monthRevenueFact([
      diag({ unit: 'Производство', sumRub: 1_017_034 }),
      diag({ unit: 'M-Glass', source: 'Просчёты', verdict: 'distrust', usedForFact: false, sumRub: null }),
      diag({ unit: 'M-Glass', source: 'Оплаты', verdict: 'partial', usedForFact: false, sumRub: 500_000 }),
    ])
    expect(f.total).toBe(1_017_034)
    expect(f.units).toEqual([
      { unit: 'M-Glass', revenue: null },
      { unit: 'Производство', revenue: 1_017_034 },
    ])
    expect(f.missing).toEqual(['M-Glass'])
  })

  it('без источников — ноль и оба юнита «нет данных», а не молчаливый ноль', () => {
    const f = monthRevenueFact([])
    expect(f.total).toBe(0)
    expect(f.missing).toEqual(['M-Glass', 'Производство'])
  })

  it('когда розница станет доверенной, она войдёт в сумму без правки экрана', () => {
    const f = monthRevenueFact([
      diag({ unit: 'Производство', sumRub: 100 }),
      diag({ unit: 'M-Glass', sumRub: 50 }),
    ])
    expect(f.total).toBe(150)
    expect(f.missing).toEqual([])
  })

  it('начало месяца — как на /cfo/model', () => {
    expect(factMonthStart(new Date(2026, 9, 7, 23, 59))).toBe('2026-10-01')
    expect(factMonthStart(new Date(2026, 0, 1))).toBe('2026-01-01')
  })
})
