import { describe, it, expect } from 'vitest'
import { fundPlan, parsePlan } from '@/lib/accounting/fundPlan'

describe('план фонда ДДС из состава', () => {
  it('сумма планов подфондов; без планов — плана нет', () => {
    const plans = new Map([[1, 80000], [2, 70000.5], [9, 1]])
    expect(fundPlan([1, 2, 3], plans)).toBe(150000.5)
    expect(fundPlan([3, 4], plans)).toBeNull()
    expect(fundPlan([], plans)).toBeNull()
  })

  it('ввод суммы с пробелами и запятой; пусто — снять план; мусор и минус — ошибка', () => {
    expect(parsePlan('80 000')).toBe(80000)
    expect(parsePlan('80000,5')).toBe(80000.5)
    expect(parsePlan('  ')).toBeNull()
    expect(parsePlan('восемьдесят')).toBeNaN()
    expect(parsePlan('-5')).toBeNaN()
  })
})
