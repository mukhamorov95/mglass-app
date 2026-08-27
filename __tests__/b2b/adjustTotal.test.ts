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
