import { describe, it, expect } from 'vitest'
import { readyForPickupText, quoteReminderText, paymentReminderText } from '@/lib/b2b/clientTexts'

const rub = (n: number) => `${n.toLocaleString('ru-RU')} ₽`

describe('тексты клиенту', () => {
  it('готов к выдаче: самовывоз по умолчанию, доставка — если выбрана', () => {
    expect(readyForPickupText({ ref: '05648' })).toBe(
      'Здравствуйте!\nВаш заказ № 05648 готов и упакован.\nЗабрать можно в Мытищах. Подскажите, когда вам удобно приехать или нужна доставка, — согласуем день.')
    expect(readyForPickupText({ ref: '05648', delivery: 'delivery' })).toContain('принять доставку')
  })

  it('напоминание о КП: номер, дата, сумма; без даты — без «от»', () => {
    const t = quoteReminderText({ ref: '05601', amount: 120_500.4, day: '2026-09-02' })
    expect(t).toContain(`№ 05601 от 02.09.2026 на ${rub(120_500)}.`)
    expect(quoteReminderText({ ref: '05601', amount: 1000, day: null })).toContain(`№ 05601 на ${rub(1000)}.`)
  })

  it('напоминание об оплате: счёт с заказами, частичная оплата — остаток', () => {
    const t = paymentReminderText({ invoiceNo: '124', orderRefs: ['05601', '05602'], total: 100_000, paid: 40_000 })
    expect(t).toContain('счёта № 124 (заказы № 05601, 05602).')
    expect(t).toContain(`Оплачено ${rub(40_000)}, осталось ${rub(60_000)}.`)
    const one = paymentReminderText({ invoiceNo: null, orderRefs: ['05601'], total: 50_000 })
    expect(one).toContain('оплате заказа № 05601.')
    expect(one).toContain(`Сумма к оплате — ${rub(50_000)}.`)
  })

  it('в текстах нет внутреннего: себестоимости, маржи, этапов цеха', () => {
    const all = [
      readyForPickupText({ ref: '1' }), quoteReminderText({ ref: '1', amount: 1 }),
      paymentReminderText({ invoiceNo: '1', orderRefs: [], total: 1 }),
    ].join('\n').toLowerCase()
    for (const w of ['себестоим', 'маржа', 'закалка', 'цех']) expect(all).not.toContain(w)
  })
})
