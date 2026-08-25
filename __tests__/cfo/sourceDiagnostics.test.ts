import { describe, it, expect } from 'vitest'
import { factForUnit, type SourceDiag } from '@/lib/cfo/sourceDiagnostics'

const mk = (o: Partial<SourceDiag>): SourceDiag => ({
  unit: 'X', source: 's', table: 't', records: 0, sumRub: null,
  periodFrom: null, periodTo: null, issue: '', verdict: 'distrust',
  reason: '', usedForFact: false, ...o,
})

describe('factForUnit — без молчаливых нулей', () => {
  it('доверенный источник → возвращает его сумму', () => {
    const diags = [mk({ unit: 'Производство', verdict: 'trust', usedForFact: true, sumRub: 3_080_786 })]
    expect(factForUnit(diags, 'Производство')).toEqual({ revenue: 3_080_786, captured: true })
  })

  it('только ненадёжные источники → «данных нет» (null), не ноль', () => {
    const diags = [
      mk({ unit: 'M-Glass', source: 'calculations', verdict: 'distrust' }),
      mk({ unit: 'M-Glass', source: 'crm_sales', verdict: 'distrust' }),
      mk({ unit: 'M-Glass', source: 'payments', verdict: 'partial', sumRub: 565_331 }),
    ]
    expect(factForUnit(diags, 'M-Glass')).toEqual({ revenue: null, captured: false })
  })

  it('trust, но не usedForFact → не берём', () => {
    const diags = [mk({ unit: 'M-Glass', verdict: 'trust', usedForFact: false, sumRub: 100 })]
    expect(factForUnit(diags, 'M-Glass').captured).toBe(false)
  })

  it('trust + usedForFact, но сумма null → не берём', () => {
    const diags = [mk({ unit: 'M-Glass', verdict: 'trust', usedForFact: true, sumRub: null })]
    expect(factForUnit(diags, 'M-Glass').captured).toBe(false)
  })

  it('нет источников для юнита → «данных нет»', () => {
    expect(factForUnit([], 'Производство')).toEqual({ revenue: null, captured: false })
  })
})
