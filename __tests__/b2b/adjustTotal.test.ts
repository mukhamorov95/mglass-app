import { describe, it, expect } from 'vitest'
import { rescaleItemsToTotal } from '../../lib/b2b/adjustTotal'

// Владелец меняет итог заказа в любую сторону: скидка при торге или подъём, когда
// продали дороже просчёта. Раньше подъём был запрещён — заказ навсегда оставался
// с суммой, за которую его НЕ продали, и реестр продаж врал.

const items = [
  { saleIncVat: 100_000, costExVat: 50_000, materialName: 'Стекло A' },
  { saleIncVat: 150_000, costExVat: 70_000, materialName: 'Стекло B' },
  { saleIncVat: 50_000,  costExVat: 20_000, materialName: 'Стекло C' },
]
const OLD = 300_000
const sum = (arr: { saleIncVat?: unknown }[]) => arr.reduce((s, i) => s + Number(i.saleIncVat), 0)

describe('пересчёт заказа под новую сумму', () => {
  it('подъём: сумма позиций сходится с новым итогом до рубля', () => {
    const r = rescaleItemsToTotal(items, OLD, 355_000)
    expect(sum(r)).toBe(355_000)
  })

  it('снижение по-прежнему сходится — прежний сценарий не сломан', () => {
    const r = rescaleItemsToTotal(items, OLD, 270_000)
    expect(sum(r)).toBe(270_000)
  })

  it('при подъёме цены растут, а себестоимость остаётся нетронутой', () => {
    const r = rescaleItemsToTotal(items, OLD, 355_000)
    expect(Number(r[0].saleIncVat)).toBeGreaterThan(100_000)
    expect(Number(r[0].costExVat)).toBe(50_000)
    expect(Number(r[1].costExVat)).toBe(70_000)
  })

  it('при подъёме маржа растёт, при снижении падает', () => {
    const up = rescaleItemsToTotal(items, OLD, 355_000)
    const down = rescaleItemsToTotal(items, OLD, 270_000)
    expect(Number(up[0].margin)).toBeGreaterThan(Number(down[0].margin))
  })

  it('НДС и цена без НДС в сумме дают цену с НДС — на каждой позиции', () => {
    for (const it of rescaleItemsToTotal(items, OLD, 355_000)) {
      expect(Number(it.saleExVat) + Number(it.outputVat)).toBe(Number(it.saleIncVat))
    }
  })

  it('некруглая сумма не теряет и не добавляет рублей', () => {
    const r = rescaleItemsToTotal(items, OLD, 355_777)
    expect(sum(r)).toBe(355_777)
  })

  it('одна позиция получает всю сумму целиком', () => {
    const r = rescaleItemsToTotal([items[0]], 100_000, 123_456)
    expect(Number(r[0].saleIncVat)).toBe(123_456)
  })

  it('прочие поля позиции не теряются', () => {
    const r = rescaleItemsToTotal(items, OLD, 355_000)
    expect(r[0].materialName).toBe('Стекло A')
  })
})

// Разъезд базы масштабирования: коэффициент считался от итога ПОСЛЕ скидки и
// договорных цен, а умножался на прайсовую saleIncVat. В проде так вышли
// отрицательные позиции в заказах 05024, 05097, 05338.
describe('масштабируем то, из чего сложен старый итог', () => {
  const list = [
    { saleIncVat: 3000, costExVat: 1000 },
    { saleIncVat: 3000, costExVat: 1000 },
    { saleIncVat: 3000, costExVat: 1000 },
  ]

  it('со скидкой 20% позиции растут одинаково, а не «две вверх, одна вниз»', () => {
    const r = rescaleItemsToTotal(list, 7200, 7500, 20)
    expect(sum(r)).toBe(7500)
    const vals = r.map(i => Number(i.saleIncVat))
    expect(Math.max(...vals) - Math.min(...vals)).toBeLessThanOrEqual(2)
  })

  it('ни одна позиция не уходит в ноль и в минус', () => {
    for (const n of [5, 7, 10]) {
      const many = Array.from({ length: n }, () => ({ saleIncVat: 3000, costExVat: 1000 }))
      const r = rescaleItemsToTotal(many, Math.round(3000 * n * 0.8), Math.round(3000 * n * 0.85), 20)
      for (const it of r) expect(Number(it.saleIncVat)).toBeGreaterThan(0)
    }
  })

  it('договорные цены позиций — тоже база: масштабируются они, а не прайс', () => {
    const withManual = [
      { saleIncVat: 100_000, manualTotal: 30_000, costExVat: 10_000 },
      { saleIncVat: 100_000, manualTotal: 20_000, costExVat: 10_000 },
    ]
    const r = rescaleItemsToTotal(withManual, 50_000, 95_000)
    expect(sum(r)).toBe(95_000)
    // 30:20 → 57:38 тысяч, а не «190 тысяч первой и минус 95 второй»
    expect(Number(r[0].saleIncVat)).toBeGreaterThan(Number(r[1].saleIncVat))
    expect(Number(r[1].saleIncVat)).toBeGreaterThan(0)
  })

  it('старый итог без скидки и договорных — поведение прежнее', () => {
    const r = rescaleItemsToTotal(items, OLD, 355_000, 0)
    expect(sum(r)).toBe(355_000)
    expect(Number(r[0].saleIncVat)).toBeGreaterThan(100_000)
  })
})
