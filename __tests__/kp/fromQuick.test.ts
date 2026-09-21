import { describe, it, expect } from 'vitest'
import { kpFromQuick, quickTotals, designerMarkupPct, type QuickCartItem } from '@/lib/kp/fromQuick'

const item = (p: Partial<QuickCartItem> & { title: string; productPrice: number }): QuickCartItem => ({
  installTotal: 0, sections: 1, perSection: 0, delivery: 0, lift: 0,
  total: p.productPrice + (p.installTotal ?? 0) + (p.delivery ?? 0) + (p.lift ?? 0),
  ...p,
})

describe('designerMarkupPct', () => {
  it('добавляет 5% компании к проценту дизайнера', () => {
    expect(designerMarkupPct(10)).toBe(15)
    expect(designerMarkupPct(15)).toBe(20)
  })
  it('без дизайнера надбавки нет', () => {
    expect(designerMarkupPct(0)).toBe(0)
    expect(designerMarkupPct(undefined)).toBe(0)
  })
})

describe('quickTotals', () => {
  it('скидки идут после надбавки дизайнера', () => {
    const t = quickTotals({
      cart: [item({ title: 'Душевая', productPrice: 100000 })],
      designer: 10, measureDiscount: '5000', extraMode: 'pct', extraVal: '10',
    })
    expect(t.withDesigner).toBe(115000)
    expect(t.measureDisc).toBe(5000)
    expect(t.extraDisc).toBe(11000)
    expect(t.finalGrand).toBe(99000)
  })
  it('скидка не уводит итог в минус', () => {
    const t = quickTotals({ cart: [item({ title: 'Зеркало', productPrice: 10000 })], measureDiscount: '99000' })
    expect(t.measureDisc).toBe(10000)
    expect(t.finalGrand).toBe(0)
  })
})

describe('kpFromQuick', () => {
  it('пустая корзина — КП не из чего собирать', () => {
    expect(kpFromQuick({ cart: [] })).toBeNull()
    expect(kpFromQuick({})).toBeNull()
  })

  // Расчёт 140 (Шамиль ЗОРГЕ, 21.09.2026) — тот, который владелец искал в КП.
  it('снимок сохранённого расчёта собирается в КП', () => {
    const kp = kpFromQuick({
      cart: [
        item({ title: 'Перегородка на ванну', productPrice: 68333, installTotal: 13000, sections: 2, perSection: 6500, delivery: 5000 }),
        item({ title: 'Зеркало в спальню', productPrice: 38546, installTotal: 6500, sections: 1, perSection: 6500 }),
        item({ title: 'Зеркало в прихожую', productPrice: 77635, installTotal: 19500, sections: 3, perSection: 6500 }),
      ],
      designer: 10, clientName: 'Шамиль ЗОРГЕ', clientPhone: '+79884679728',
    })!
    expect(kp.subtotal).toBe(262791)
    expect(kp.total).toBe(262791)
    expect(kp.client_name).toBe('Шамиль ЗОРГЕ')
    expect(kp.title).toBe('КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ')
    // изделие + монтаж + доставка, изделие + монтаж, изделие + монтаж
    expect(kp.items).toHaveLength(7)
    expect(kp.items[0]).toEqual({ name: 'Перегородка на ванну', qty: 1, price: 78583, sum: 78583 })
    expect(kp.items[1]).toEqual({ name: 'Монтаж — Перегородка на ванну', qty: 2, price: 7475, sum: 14950 })
    expect(kp.items[2]).toEqual({ name: 'Доставка — Перегородка на ванну', qty: 1, sum: 5750 })
  })

  it('одно изделие — его название становится заголовком КП', () => {
    const kp = kpFromQuick({ cart: [item({ title: 'Душевая кабина', productPrice: 50000 })] })!
    expect(kp.title).toBe('ДУШЕВАЯ КАБИНА')
    expect(kp.items).toHaveLength(1)
    expect(kp.items[0].name).toBe('Душевая кабина')
  })

  it('строки КП складываются в подытог, который в них же и напечатан', () => {
    // Надбавка 15% на цены, дающие в сумме .5 — округление каждой строки
    // отдельно уводит сумму от подытога, если остаток не пристроить.
    const kp = kpFromQuick({
      cart: [
        item({ title: 'A', productPrice: 3333 }),
        item({ title: 'B', productPrice: 3333 }),
        item({ title: 'C', productPrice: 3333 }),
      ],
      designer: 10,
    })!
    expect(kp.items.reduce((s, i) => s + i.sum, 0)).toBe(kp.subtotal)
  })

  it('остаток округления падает в самую крупную строку', () => {
    const kp = kpFromQuick({
      cart: [item({ title: 'Крупное', productPrice: 99999, installTotal: 3333, sections: 1, perSection: 3333 })],
      designer: 15,
    })!
    expect(kp.items.reduce((s, i) => s + i.sum, 0)).toBe(kp.subtotal)
    const big = kp.items[0]
    expect(big.name).toBe('Крупное')
    // цена и сумма строки с qty=1 не расходятся после правки остатка
    expect(big.price).toBe(big.sum)
  })
})
