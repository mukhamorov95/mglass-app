import { describe, it, expect } from 'vitest'
import { classify, sortFlows, summarize, daysBetween, type FlowSpec, type FlowRow } from '@/lib/b2b/adoptionAudit'

const NOW = new Date('2026-09-10T00:00:00Z').getTime()  // фиксированное «сейчас»
const spec = (o: Partial<FlowSpec>): FlowSpec => ({
  key: 'k', title: 't', domain: 'b2b', shipped: '2026-08-25', measurable: true, ...o,
})

describe('classify — возраст отделяет мёртвое от нового', () => {
  it('старая фича без использований = мертва, не «новая»', () => {
    const r = classify(spec({ shipped: '2026-06-30' }), { usesTotal: 0, uses90d: 0, uses30d: 0 }, NOW)
    expect(r.verdict).toBe('мертва')
  })

  it('вчерашняя фича без использований = слишком новая, НЕ мертва', () => {
    const r = classify(spec({ shipped: '2026-09-09' }), { usesTotal: 0, uses90d: 0, uses30d: 0 }, NOW)
    expect(r.verdict).toBe('слишком новая')
  })

  it('новая, но уже есть использования = ранний старт', () => {
    const r = classify(spec({ shipped: '2026-09-05' }), { usesTotal: 3, uses90d: 3, uses30d: 3 }, NOW)
    expect(r.verdict).toBe('ранний старт')
  })

  it('старая, использовалась раньше, но не в 30 дней = затухает', () => {
    const r = classify(spec({ shipped: '2026-05-01' }), { usesTotal: 40, uses90d: 5, uses30d: 0 }, NOW)
    expect(r.verdict).toBe('затухает')
  })

  it('старая и с недавним использованием = живёт', () => {
    const r = classify(spec({ shipped: '2026-05-01' }), { usesTotal: 100, uses90d: 60, uses30d: 20 }, NOW)
    expect(r.verdict).toBe('живёт')
  })

  it('нет счётчика = не измеряется, что бы ни пришло', () => {
    const r = classify(spec({ measurable: false }), { usesTotal: null, uses90d: 0, uses30d: 0 }, NOW)
    expect(r.verdict).toBe('не измеряется')
  })
})

describe('sortFlows / summarize', () => {
  it('мёртвое и затухающее — первыми (это решения владельца)', () => {
    const rows: FlowRow[] = [
      classify(spec({ key: 'new', shipped: '2026-09-09' }), { usesTotal: 0, uses90d: 0, uses30d: 0 }, NOW),
      classify(spec({ key: 'dead', shipped: '2026-06-01' }), { usesTotal: 0, uses90d: 0, uses30d: 0 }, NOW),
      classify(spec({ key: 'alive', shipped: '2026-05-01' }), { usesTotal: 50, uses90d: 30, uses30d: 10 }, NOW),
    ]
    const sorted = sortFlows(rows)
    expect(sorted[0].key).toBe('dead')
    const s = summarize(rows)
    expect(s).toMatchObject({ dead: 1, alive: 1, tooNew: 1, total: 3 })
  })
})

describe('daysBetween', () => {
  it('считает возраст в днях', () => {
    expect(daysBetween('2026-09-01', NOW)).toBe(9)
    expect(daysBetween('мусор', NOW)).toBe(0)
  })
})
