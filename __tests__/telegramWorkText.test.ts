import { describe, it, expect } from 'vitest'
import { buildTelegramWorkText } from '@/lib/b2b/telegramWorkText'

// Текст переехал из экрана просчётов в lib (У5) — тест закрепляет, что он не изменился.
const q = (over: Partial<Parameters<typeof buildTelegramWorkText>[0]> = {}) => ({
  id: 5268, custom_number: null, client_name: 'M-GLASS',
  items: [], total_sale_inc_vat: 100000, total_after_discount: 90000, ...over,
})

describe('текст заказа для Telegram', () => {
  it('номер, клиент и сумма с точками', () => {
    const t = buildTelegramWorkText(q({ custom_number: '0908-4' }))
    expect(t.split('\n')[0]).toBe('0908-4')
    expect(t.split('\n')[1]).toBe('МГЛАСС')
    expect(t).toContain('🥝90.000 руб')
  })

  it('без номера — из id, без клиента — «Без клиента»', () => {
    const t = buildTelegramWorkText(q({ client_name: '' }))
    expect(t.split('\n')[0]).toBe('005268')
    expect(t.split('\n')[1]).toBe('Без клиента')
  })

  it('одинаковые позиции складываются в одну строку', () => {
    const item = { materialName: 'Прозрачное', thickness: 8, quantity: 2, hasTempering: true, width: 600, height: 800 }
    const t = buildTelegramWorkText(q({ items: [item, { ...item, quantity: 3 }] }))
    expect(t).toContain('Стекло 8мм м1 закаленное - 5 шт')
  })

  it('квадратное зеркало — круглое, прямоугольное — прямоугольное', () => {
    const t = buildTelegramWorkText(q({ items: [
      { materialName: 'Зеркало Серебро', category: 'зеркало', thickness: 4, quantity: 1, width: 500, height: 500 },
      { materialName: 'Зеркало Серебро', category: 'зеркало', thickness: 4, quantity: 1, width: 500, height: 900 },
    ] }))
    expect(t).toContain('Зеркало 4мм сильвер круглое - 1 шт')
    expect(t).toContain('Зеркало 4мм сильвер прямоугольное - 1 шт')
  })

  it('пустой расчёт отправляет к PDF', () => {
    expect(buildTelegramWorkText(q())).toContain('Расчёт B2B - см. PDF')
  })
})
