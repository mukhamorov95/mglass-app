import { describe, expect, it } from 'vitest'
import { buildRecheck, dueForRecheck, recheckText } from '@/lib/ai/recRecheck'
import { changeText, type Fact, type Recommendation } from '@/lib/ai/recommendationTypes'

const fact = (id: string, value: number, unit: Fact['unit'], period: string): Fact => ({ id, label: id === 'sales.avg.last_month' ? 'Средний чек' : 'Маржа', value, unit, period, source: 'тест' })
const evidence = { facts: [fact('sales.avg.last_month', 127_263, 'rub', 'сентябрь 2026'), fact('margin.pct.q', 36.7, 'pct', 'июль — сентябрь 2026')], check: 'sales.avg.last_month', unverified: [] }
const now = new Date('2026-11-10T06:00:00Z')
// toLocaleString('ru-RU') ставит между разрядами неразрывный пробел.
const sp = (s: string) => s.replace(/\u00a0/g, ' ')

describe('dueForRecheck', () => {
  const base = { status: 'done' as const, done_at: '2026-10-08T10:00:00Z', evidence, recheck_at: null }
  it('сделано 30+ дней назад, с цифрами и без сверки — пора', () => {
    expect(dueForRecheck(base, now)).toBe(true)
  })
  it('рано, уже сверено, без цифр или не «сделано» — нет', () => {
    expect(dueForRecheck({ ...base, done_at: '2026-10-20T10:00:00Z' }, now)).toBe(false)
    expect(dueForRecheck({ ...base, recheck_at: '2026-11-08T06:00:00Z' }, now)).toBe(false)
    expect(dueForRecheck({ ...base, evidence: null }, now)).toBe(false)
    expect(dueForRecheck({ ...base, status: 'in_work' }, now)).toBe(false)
  })
})

describe('buildRecheck и текст', () => {
  const current = new Map([['sales.avg.last_month', fact('sales.avg.last_month', 135_000, 'rub', 'октябрь 2026')]])
  const rc = buildRecheck({ evidence }, current, now)

  it('было → стало по той же цифре; не посчитанная сейчас — null', () => {
    expect(rc.items[0]).toMatchObject({ before: 127_263, beforePeriod: 'сентябрь 2026', after: 135_000, afterPeriod: 'октябрь 2026' })
    expect(rc.items[1].after).toBeNull()
  })
  it('рубли — в процентах от «было», проценты — в пунктах', () => {
    expect(sp(changeText(rc.items[0]))).toBe('127 263 ₽ (сентябрь 2026) → 135 000 ₽ (октябрь 2026), +6,1 %')
    expect(changeText({ ...rc.items[1], after: 34.2, afterPeriod: 'август — октябрь 2026' })).toContain('-2,5 п.')
    expect(changeText(rc.items[1])).toBe('сейчас посчитать нельзя — источник не ответил')
  })
  it('сообщение: главная цифра — check, жирным', () => {
    const t = sp(recheckText({ title: 'Поднять средний чек', done_at: '2026-10-08T10:00:00Z', result_note: 'ввели допродажу', evidence } as Pick<Recommendation, 'title' | 'done_at' | 'result_note' | 'evidence'>, rc))
    expect(t).toContain('📏 <b>Сверка через месяц</b>: Поднять средний чек')
    expect(t).toContain('Сделано 08.10.2026: ввели допродажу')
    expect(t).toContain('<b>Средний чек</b>: 127 263 ₽')
  })
})
