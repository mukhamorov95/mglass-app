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

  it('обработка — к детали: песочка из услуги, фацет, отверстия, вырезы, комментарий без повтора размера', () => {
    const msg = sp(buildProductionMessage({
      id: 5669, custom_number: '05669', client_name: 'Клиент', total_after_discount: 16_868,
      items: [
        // 05669: пескоструй выбран услугой, признак «Песочка» не стоит — так было у всех таких деталей.
        { materialName: 'Осветлённое', category: 'зеркало', thickness: 4, width: 1158, height: 2322, quantity: 1, totalAreaNet: 2.6889,
          hasSandblast: false, hasHoles: false, services: [{ id: 28, name: 'Пескоструй по трафарету (рисунок/частичное)' }, { id: 15, name: 'Разработка макета в электронном виде (вектор)' }, { id: -1000002, name: 'Крупногабарит: высота 2600–2900 мм (+20%)' }] },
        { materialName: 'Осветлённое', category: 'зеркало', thickness: 4, width: 750, height: 1900, quantity: 1, totalAreaNet: 1.43,
          hasFacet: true, facetTypeMm: 10, holes: [{ d: 12, n: 4 }, { d: 20, n: 2 }], hasCutouts: true, cutouts: 1,
          comment: '750×1900 мм · лента: LUX 120 led 9,6W 4500K 12V · БП КАРАНДАШ 100W' },
      ],
    }))
    expect(msg).toContain('  1158×2322 мм — 1 шт · песочка по трафарету, макет\n')
    expect(msg).toContain('  750×1900 мм — 1 шт · фацет 10 мм, отв. 4×⌀12, 2×⌀20, вырезы ×1 · лента: LUX 120 led 9,6W 4500K 12V · БП КАРАНДАШ 100W\n')
    expect(msg).not.toContain('Крупногабарит')
  })

  it('подпись для тоста: номер, клиент, штуки и площадь всего заказа', () => {
    expect(sp(productionMessageSummary(order))).toBe('05648 · M GLASS · 6 шт · 4,8 м²')
  })
})
