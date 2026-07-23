import { describe, it, expect } from 'vitest'
import { reconcileKp } from '@/lib/kpReconcile'

// Регрессия: КП #46 — доставка в строке 0, но 3500 сидит в total (80242 vs 76742).
describe('reconcileKp — доставка не теряется', () => {
  it('единственную пустую строку заполняет из разницы итого − остальные', () => {
    const kp = reconcileKp({
      items: [
        { name: 'Изделие', qty: '1', price: '38554', sum: '38554' },
        { name: 'Монтаж', qty: '1', price: '6500', sum: '6500' },
        { name: 'Изделие', qty: '1', price: '25188', sum: '25188' },
        { name: 'Монтаж', qty: '1', price: '6500', sum: '6500' },
        { name: 'Доставка — Изделий', qty: '1', price: '', sum: '0' },
      ],
      subtotal: 76742, total: 80242,
    })
    const items = kp.items as Record<string, unknown>[]
    expect(items[4].sum).toBe(3500)   // доставка получила свою сумму
    expect(items[4].price).toBe(3500) // и цену за штуку
  })

  it('делит цену на количество, если qty > 1', () => {
    const kp = reconcileKp({
      items: [
        { name: 'Изделие', qty: '1', price: '10000', sum: '10000' },
        { name: 'Доставка', qty: '2', price: '', sum: '' },
      ],
      total: 13000,
    })
    const items = kp.items as Record<string, unknown>[]
    expect(items[1].sum).toBe(3000)
    expect(items[1].price).toBe(1500)
  })

  it('ничего не трогает, если пустых строк несколько (нельзя однозначно)', () => {
    const kp = reconcileKp({
      items: [
        { name: 'Изделие', qty: '1', price: '10000', sum: '10000' },
        { name: 'Доставка', sum: '' },
        { name: 'Подъём', sum: '' },
      ],
      total: 15000,
    })
    const items = kp.items as Record<string, unknown>[]
    expect(items[1].sum).toBe('')
    expect(items[2].sum).toBe('')
  })

  it('не доливает, если итог не превышает сумму строк', () => {
    const kp = reconcileKp({
      items: [
        { name: 'Изделие', qty: '1', price: '10000', sum: '10000' },
        { name: 'Доставка', sum: '0' },
      ],
      total: 10000,
    })
    const items = kp.items as Record<string, unknown>[]
    expect(items[1].sum).toBe('0')
  })

  it('проставляет subtotal/total из строк, если AI их не дал', () => {
    const kp = reconcileKp({
      items: [
        { name: 'Изделие', sum: '10000' },
        { name: 'Монтаж', sum: '5000' },
      ],
    })
    expect(kp.subtotal).toBe(15000)
    expect(kp.total).toBe(15000)
  })
})
