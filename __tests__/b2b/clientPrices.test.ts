import { describe, it, expect } from 'vitest'
import { clientPriceMap, applyClientPrices, discountForMaterial } from '@/lib/b2b/clientPrices'
import type { B2BMaterial } from '@/lib/types'

const mat = (id: number, sale: number) => ({ id, name: `М${id}`, category: 'стекло', thickness: 6, sale_price: sale } as unknown as B2BMaterial)

describe('прайс клиента', () => {
  it('перекрывает общую цену только по своим материалам', () => {
    const prices = clientPriceMap([{ material_id: 2, sale_price: 1800 }])
    const out = applyClientPrices([mat(1, 2200), mat(2, 2400)], prices)
    expect(out[0].sale_price).toBe(2200)
    expect(out[1].sale_price).toBe(1800)
    expect(out[1].clientPriced).toBe(true)
  })

  it('неактивные и нулевые строки игнорируются', () => {
    const prices = clientPriceMap([
      { material_id: 1, sale_price: 1000, active: false },
      { material_id: 2, sale_price: 0 },
      { material_id: 3, sale_price: 1500 },
    ])
    expect(prices.has(1)).toBe(false)
    expect(prices.has(2)).toBe(false)
    expect(prices.get(3)).toBe(1500)
  })

  it('скидка к индивидуальной цене не применяется — иначе задвоится', () => {
    const prices = clientPriceMap([{ material_id: 2, sale_price: 1800 }])
    const [general, own] = applyClientPrices([mat(1, 2200), mat(2, 2400)], prices)
    expect(discountForMaterial(general, 10)).toBe(10)
    expect(discountForMaterial(own, 10)).toBe(0)
  })

  it('пустой прайс не трогает материалы', () => {
    const list = [mat(1, 2200)]
    expect(applyClientPrices(list, new Map())).toBe(list)
  })
})
