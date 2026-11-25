import { describe, expect, it } from 'vitest'
import { statusChips, statusOf } from '@/lib/partner/stageFilter'

const o = (stage: string, lane = 'in_work') => ({ lane, stage })

describe('фильтр заказов в работе по статусам', () => {
  it('весь путь заказа виден всегда, этапы без заказов — с нулём', () => {
    expect(statusChips([o('Готов к выдаче'), o('Сверление'), o('Резка'), o('Резка')]).map(c => `${c.status} ${c.count}`))
      .toEqual(['Резка 2', 'Полировка 0', 'Сверление 1', 'Закалка 0', 'Упаковка 0', 'Готов к выдаче 1'])
  })
  it('редкие статусы добавляются на своё место, только когда есть', () => {
    const list = statusChips([o('что угодно', 'submitted'), o('Материал')]).map(c => c.status)
    expect(list.slice(0, 3)).toEqual(['Отправлен в работу', 'Материал', 'Резка'])
  })
  it('отгруженный и отправленный — свои статусы', () => {
    expect(statusOf(o('что угодно', 'shipped'))).toBe('Отгружен')
    expect(statusOf(o('что угодно', 'submitted'))).toBe('Отправлен в работу')
  })
})
