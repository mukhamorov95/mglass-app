import { describe, expect, it } from 'vitest'
import { statusChips, statusOf } from '@/lib/partner/stageFilter'

const o = (stage: string, lane = 'in_work') => ({ lane, stage })

describe('фильтр заказов в работе по статусам', () => {
  it('статусы идут по ходу заказа, со счётом', () => {
    expect(statusChips([o('Готов к выдаче'), o('Сверление'), o('Резка'), o('Резка'), o('Отправлен в работу', 'submitted')])).toEqual([
      { status: 'Отправлен в работу', count: 1 }, { status: 'Резка', count: 2 },
      { status: 'Сверление', count: 1 }, { status: 'Готов к выдаче', count: 1 },
    ])
  })
  it('выбранный статус не пропадает, когда по нему пусто', () => {
    expect(statusChips([o('Резка')], 'Закалка')).toEqual([{ status: 'Резка', count: 1 }, { status: 'Закалка', count: 0 }])
  })
  it('отправленный заказ — свой статус', () => {
    expect(statusOf(o('что угодно', 'submitted'))).toBe('Отправлен в работу')
  })
})
