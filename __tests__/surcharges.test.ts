import { describe, it, expect } from 'vitest'
import { applicableSurcharges, surchargeServicesFor, surchargeSyntheticId, isSurchargeServiceId, type SurchargeRule } from '@/lib/surcharges'

// Стартовый справочник (как в миграции 20260730_b2b_surcharge_rules).
const RULES: SurchargeRule[] = [
  { id: 1, axis: 'length', min_mm: 2400, max_mm: 2600, surcharge_percent: 10, label: 'Высота 2400–2600', shape_filter: null, active: true, sort_order: 10 },
  { id: 2, axis: 'length', min_mm: 2600, max_mm: 2900, surcharge_percent: 20, label: 'Высота 2600–2900', shape_filter: null, active: true, sort_order: 11 },
  { id: 3, axis: 'length', min_mm: 2900, max_mm: 3200, surcharge_percent: 35, label: 'Высота 2900–3200', shape_filter: null, active: true, sort_order: 12 },
  { id: 4, axis: 'width', min_mm: 1200, max_mm: 1400, surcharge_percent: 10, label: 'Ширина 1200–1400', shape_filter: null, active: true, sort_order: 20 },
  { id: 5, axis: 'width', min_mm: 1400, max_mm: 1600, surcharge_percent: 20, label: 'Ширина 1400–1600', shape_filter: null, active: true, sort_order: 21 },
  { id: 6, axis: 'width', min_mm: 1600, max_mm: 2000, surcharge_percent: 30, label: 'Ширина 1600–2000', shape_filter: null, active: true, sort_order: 22 },
  { id: 7, axis: 'width', min_mm: 2000, max_mm: null, surcharge_percent: 45, label: 'Ширина >2000', shape_filter: null, active: true, sort_order: 23 },
  { id: 8, axis: 'shape', min_mm: 1000, max_mm: 1500, surcharge_percent: 30, label: 'Форма 1000–1500', shape_filter: 'curved', active: true, sort_order: 30 },
  { id: 9, axis: 'shape', min_mm: 1500, max_mm: null, surcharge_percent: 60, label: 'Форма >1500', shape_filter: 'curved', active: true, sort_order: 31 },
]

describe('applicableSurcharges', () => {
  it('обычная небольшая деталь — без надбавок', () => {
    expect(applicableSurcharges({ width: 800, height: 2000 }, RULES)).toHaveLength(0)
  })

  it('ключ по длинной/короткой стороне не зависит от ориентации', () => {
    const a = applicableSurcharges({ width: 900, height: 2500 }, RULES)
    const b = applicableSurcharges({ width: 2500, height: 900 }, RULES)
    expect(a.map(r => r.id).sort()).toEqual(b.map(r => r.id).sort())
    // 2500 — длинная сторона → length-ступень 2400–2600 (+10%)
    expect(a.map(r => r.id)).toContain(1)
  })

  it('высокая деталь 900×2700 → length 2600–2900 (+20%)', () => {
    const r = applicableSurcharges({ width: 900, height: 2700 }, RULES)
    expect(r.map(x => x.id)).toEqual([2])
  })

  it('крупная 1500×2950 → length 2900–3200 (+35%) и width 1400–1600 (+20%)', () => {
    const r = applicableSurcharges({ width: 1500, height: 2950 }, RULES)
    expect(r.map(x => x.id).sort()).toEqual([3, 5])
  })

  it('верхняя граница исключительна, нижняя включительна', () => {
    // ровно 2600 → попадает во 2-ю ступень (2600–2900), не в 1-ю (2400–2600)
    const r = applicableSurcharges({ width: 500, height: 2600 }, RULES)
    expect(r.map(x => x.id)).toEqual([2])
  })

  it('shape-ступени применяются только к curved', () => {
    expect(applicableSurcharges({ width: 1200, height: 1200 }, RULES).filter(r => r.axis === 'shape')).toHaveLength(0)
    const curved = applicableSurcharges({ width: 1200, height: 1200, shape: 'curved' }, RULES)
    expect(curved.map(r => r.id)).toContain(8) // 1200 в 1000–1500
  })

  it('неактивные правила игнорируются', () => {
    const off = RULES.map(r => r.id === 2 ? { ...r, active: false } : r)
    expect(applicableSurcharges({ width: 900, height: 2700 }, off)).toHaveLength(0)
  })

  it('нулевые габариты → без надбавок', () => {
    expect(applicableSurcharges({ width: 0, height: 0 }, RULES)).toHaveLength(0)
  })
})

describe('surchargeServicesFor', () => {
  it('синтетические услуги: percent, cost_price 0, отрицательный id', () => {
    const svcs = surchargeServicesFor({ width: 1500, height: 2950 }, RULES)
    expect(svcs).toHaveLength(2)
    for (const s of svcs) {
      expect(s.type).toBe('percent')
      expect(s.cost_price).toBe(0)
      expect(s.id).toBeLessThan(0)
      expect(isSurchargeServiceId(s.id)).toBe(true)
      expect(s.name).toMatch(/\+\d+%\)$/)
    }
  })

  it('снятые вручную (dismissed) не попадают в услуги', () => {
    const all = surchargeServicesFor({ width: 1500, height: 2950 }, RULES)
    const dismissed = surchargeServicesFor({ width: 1500, height: 2950 }, RULES, new Set([3]))
    expect(all).toHaveLength(2)
    expect(dismissed).toHaveLength(1)
    expect(dismissed[0].ruleId).toBe(5)
  })

  it('синтетический id уникален по правилу и распознаётся', () => {
    expect(surchargeSyntheticId(1)).not.toBe(surchargeSyntheticId(2))
    expect(isSurchargeServiceId(surchargeSyntheticId(999))).toBe(true)
    expect(isSurchargeServiceId(5)).toBe(false)
  })
})
