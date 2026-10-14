import { describe, it, expect } from 'vitest'
import { latestPayment, paidByOf } from '@/lib/b2b/paidBy'

describe('кто отметил оплату заказа', () => {
  it('кнопка «Оплачен» — имя отметившего', () => {
    expect(paidByOf({ id: 1, source: 'b2b_order', entered_by_name: 'Нуржан Ахметов', paid_at: '2026-10-03' }))
      .toEqual({ label: 'Нуржан', title: 'Отметил(а) Нуржан Ахметов — оплата от 03.10.2026' })
  })

  it('выписка банка — «банк» и кто провёл', () => {
    expect(paidByOf({ id: 2, source: 'bank_statement_import', entered_by_name: 'Вера', paid_at: '2026-10-14' }))
      .toEqual({ label: 'банк', title: 'Пришло по выписке банка 14.10.2026, провёл(а) Вера' })
  })

  it('старая сверка без автора — без подписи и честная подсказка', () => {
    expect(paidByOf({ id: 3, source: 'reconcile', entered_by_name: null, paid_at: '2026-10-03' }))
      .toEqual({ label: null, title: 'Оплата от 03.10.2026: кто отметил — не сохранилось' })
  })

  it('берётся последний платёж: по дате, при равной дате — более поздний', () => {
    const a = { id: 5, source: 'b2b_order', entered_by_name: 'Яна', paid_at: '2026-10-01' }
    const b = { id: 4, source: 'bank_statement_import', entered_by_name: 'Вера', paid_at: '2026-10-02' }
    const c = { id: 6, source: 'b2b_order', entered_by_name: 'Алина', paid_at: '2026-10-02' }
    expect(latestPayment([a, b, c])).toBe(c)
    expect(latestPayment([])).toBeNull()
  })
})
