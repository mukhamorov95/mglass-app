import { describe, expect, it } from 'vitest'
import { clientKeyer, clientOptions, dayPresetRange, summarizeOrders } from '@/lib/b2b/ordersFilter'

describe('dayPresetRange', () => {
  // 06.10.2026 — вторник.
  const today = '2026-10-06'
  it('сегодня и вчера', () => {
    expect(dayPresetRange('today', today)).toEqual({ from: today, to: today })
    expect(dayPresetRange('yesterday', today)).toEqual({ from: '2026-10-05', to: '2026-10-05' })
    expect(dayPresetRange('yesterday', '2026-03-01')).toEqual({ from: '2026-02-28', to: '2026-02-28' })
  })
  it('неделя — с понедельника, в воскресенье — шесть дней назад', () => {
    expect(dayPresetRange('week', today)).toEqual({ from: '2026-10-05', to: today })
    expect(dayPresetRange('week', '2026-10-05')).toEqual({ from: '2026-10-05', to: '2026-10-05' })
    expect(dayPresetRange('week', '2026-10-11')).toEqual({ from: '2026-10-05', to: '2026-10-11' })
  })
  it('месяц и прошлый месяц', () => {
    expect(dayPresetRange('month', today)).toEqual({ from: '2026-10-01', to: today })
    expect(dayPresetRange('prev_month', today)).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(dayPresetRange('prev_month', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' })
  })
})

describe('покупатель', () => {
  const orders = [
    { client_id: 2, client_name: 'ShowerGlass' }, { client_id: 2, client_name: 'ShowerGlass' },
    { client_id: null, client_name: 'showerglass ' },
    { client_id: null, client_name: 'Иван' }, { client_id: 3, client_name: 'Альфа' },
    { client_id: 5, client_name: 'Двойник' }, { client_id: 6, client_name: 'Двойник' }, { client_id: null, client_name: 'Двойник' },
  ]
  const keyOf = clientKeyer(orders)
  it('заказ без карточки идёт к карточке с тем же именем', () => {
    expect(keyOf({ client_id: null, client_name: 'showerglass ' })).toBe('id:2')
    expect(keyOf({ client_id: null, client_name: 'Иван' })).toBe('name:иван')
  })
  it('имя двух карточек — без угадывания, отдельной строкой', () => {
    expect(keyOf({ client_id: null, client_name: 'Двойник' })).toBe('name:двойник')
  })
  it('список: по алфавиту (кириллица, затем латиница), с числом заказов', () => {
    const opts = clientOptions(orders, keyOf)
    expect(opts.find(o => o.key === 'id:2')).toEqual({ key: 'id:2', label: 'ShowerGlass', count: 3, clientId: 2 })
    expect(opts.map(o => o.label)).toEqual(['Альфа', 'Двойник', 'Двойник', 'Двойник', 'Иван', 'ShowerGlass'])
  })
})

describe('summarizeOrders', () => {
  type O = { sum: number; shipped: boolean; pay: 'paid' | 'partial' | 'unpaid' | 'unknown' }
  const s = summarizeOrders<O>(
    [
      { sum: 16_779.4, shipped: false, pay: 'paid' },
      { sum: 10_826, shipped: true, pay: 'paid' },
      { sum: 6_068.6, shipped: false, pay: 'partial' },
      { sum: 5_000, shipped: false, pay: 'unknown' },
    ],
    o => o.sum, o => o.shipped, o => o.pay,
  )
  it('отгруженные входят в «заказано»', () => {
    expect(s.all).toEqual({ count: 4, sum: 16_779 + 10_826 + 6_069 + 5_000 })
    expect(s.shipped).toEqual({ count: 1, sum: 10_826 })
  })
  it('части складываются в итог: этапы и оплата', () => {
    expect(s.active.sum + s.shipped.sum).toBe(s.all.sum)
    expect(s.paid.sum + s.partial.sum + s.unpaid.sum).toBe(s.all.sum)
    expect(s.unpaid).toEqual({ count: 1, sum: 5_000 })
  })
})
