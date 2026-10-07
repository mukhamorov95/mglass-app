import { describe, it, expect } from 'vitest'
import { buildProductionMessage, orderNumberOf, productionMessageSummary } from '@/lib/b2b/productionMessage'

const sp = (s: string) => s.replace(/[  ]/g, ' ')

const order = {
  id: 5648,
  custom_number: '05648',
  client_order_number: 'ЗК-17',
  client_name: 'M GLASS',
  total_sale_inc_vat: 48_200,
  total_after_discount: 45_000,
  items: [
    { materialName: 'Осветлённое', category: 'зеркало', thickness: 4, width: 1200, height: 800, quantity: 2, totalAreaNet: 1.92 },
    { materialName: 'Прозрачное', category: 'стекло', thickness: 8, width: 900, height: 2000, quantity: 1, totalAreaNet: 1.8, hasTempering: true },
    { materialName: 'Осветлённое', category: 'зеркало', thickness: 4, width: 600, height: 600, quantity: 3, totalAreaNet: 1.08 },
  ],
}

describe('производственное сообщение', () => {
  it('группирует по материалу и толщине, итог группы и договорная сумма', () => {
    expect(sp(buildProductionMessage(order))).toBe([
      '05648',
      '(ЗК-17)',
      '',
      'M GLASS',
      '',
      'Зеркало Осветлённое 4 мм, упакованное',
      '  1200×800 мм — 2 шт',
      '  600×600 мм — 3 шт',
      '  Итого: 5 шт · 3 м²',
      '',
      'Прозрачное 8 мм, закалённое, упакованное',
      '  900×2000 мм — 1 шт',
      '  Итого: 1 шт · 1,8 м²',
      '',
      '💰 45 000 ₽',
    ].join('\n'))
  })

  it('без своего номера — 00 и id; без номера клиента строки нет; без договорной — прайс', () => {
    const msg = sp(buildProductionMessage({ ...order, custom_number: '  ', client_order_number: null, total_after_discount: 0 }))
    expect(msg.startsWith('005648\n\nM GLASS\n')).toBe(true)
    expect(msg.endsWith('💰 48 200 ₽')).toBe(true)
  })

  it('пустые позиции не роняют сборку', () => {
    expect(sp(buildProductionMessage({ id: 7, client_name: 'X', items: [] }))).toBe('007\n\nX\n\n💰 0 ₽')
    expect(orderNumberOf({ id: 7, custom_number: null })).toBe('007')
  })

  it('подпись для тоста: номер, клиент, штуки и площадь всего заказа', () => {
    expect(sp(productionMessageSummary(order))).toBe('05648 · M GLASS · 6 шт · 4,8 м²')
  })
})
