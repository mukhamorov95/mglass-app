import { describe, it, expect } from 'vitest'
import {
  orderFunds, priceForTarget, splitDelivery, allocate, parseOrderFundRates, serializeOrderFundRates,
  type FundItemInput, type ItemFunds, type OrderFundRates,
} from '@/lib/pricing/orderFunds'
import { retailCalcItems } from '@/lib/pricing/retailCalcItems'
import { savedProfit } from '@/lib/pricing/financialModel'

// Ставки фондов владельца, 01.10.2026 — тот же JSON, что кладёт миграция cfo_order_funds.
const RATES_JSON = {
  as_of: '2026-10-01',
  drawing_per_shower: 1500, measure_per_shower: 2500, install_per_glass: 4500,
  delivery_moscow_per_order: 3500, delivery_region_per_order: 5000,
  tax_pct: 12, manager_pct: 3, realization_pct: 3, partner_reserve_pct: 3, partner_known_pct: 10, other_pct: 1,
}
const RATES = parseOrderFundRates(RATES_JSON)
const TARGET = 100 - 62   // cfo_settings.avg_variable_pct

// Эталон 0245 на высоте 2200: две душевые одного заказа, по три стекла, доставка по Подмосковью,
// фурнитура обеих покупается сразу (30 986 ₽). Только числа — без адреса и имени клиента.
const ORDER_0245: FundItemInput[] = [
  { label: 'М4', price: 89_104, glassCount: 3, materials: [{ key: 'glass', amount: 16_344 }, { key: 'hardware', amount: 15_866 }] },
  { label: 'М7', price: 109_813, glassCount: 3, materials: [{ key: 'glass', amount: 27_030 }, { key: 'hardware', amount: 15_120 }] },
]

const fund = (it: ItemFunds, key: string) => it.funds.find(f => f.key === key)!
const linesSum = (it: ItemFunds) => it.funds.flatMap(f => f.lines).reduce((s, l) => s + (l.amount as number), 0)

describe('orderFunds — заказ 0245 по нынешней цене', () => {
  const res = orderFunds(ORDER_0245, RATES, { deliveryZone: 'region', targetPct: TARGET })
  const [m4, m7] = res.items

  it('материалы и сдельная — как в листе владельца', () => {
    expect(fund(m4, 'materials').amount).toBe(32_210)
    expect(fund(m7, 'materials').amount).toBe(42_150)
    expect(fund(m4, 'piecework').amount).toBe(20_000)
    expect(fund(m7, 'piecework').amount).toBe(20_000)
  })

  it('остаётся 17 292 ₽ (19,4%) и 23 504 ₽ (21,4%)', () => {
    expect(m4.remains).toBe(17_292)
    expect(m4.remainsPct).toBe(19.4)
    expect(m7.remains).toBe(23_504)
    expect(m7.remainsPct).toBe(21.4)
  })

  it('строки фондов и остаток складываются в чек до рубля, доли — в 100,0%', () => {
    for (const it of res.items) {
      expect(linesSum(it) + (it.remains as number)).toBe(it.price)
      for (const f of it.funds) expect(f.lines.reduce((s, l) => s + (l.amount as number), 0)).toBe(f.amount)
      const tenths = it.funds.reduce((s, f) => s + Math.round((f.pct as number) * 10), 0) + Math.round((it.remainsPct as number) * 10)
      expect(tenths).toBe(1000)
    }
  })

  it('каждая доля продаж и налога отходит от своей ставки меньше чем на рубль', () => {
    for (const it of res.items) {
      const pcts: Record<string, number> = { tax: 12, manager: 3, realization: 3, partner: 3, other: 1 }
      for (const l of [...fund(it, 'tax').lines, ...fund(it, 'sales').lines]) {
        expect(Math.abs((l.amount as number) - it.price * pcts[l.key] / 100)).toBeLessThan(1)
      }
    }
  })

  it('цена для цели 38% — 130 525 и 155 375 ₽', () => {
    expect(m4.priceForTarget).toBe(130_525)
    expect(m7.priceForTarget).toBe(155_375)
  })
})

describe('цена от цели — круговой тест утверждает цель, а не формулу', () => {
  it('при priceForTarget остаётся 38% чека ±1 ₽ и строки сходятся с чеком', () => {
    const first = orderFunds(ORDER_0245, RATES, { deliveryZone: 'region', targetPct: TARGET })
    const repriced = ORDER_0245.map((it, i) => ({ ...it, price: first.items[i].priceForTarget as number }))
    const res = orderFunds(repriced, RATES, { deliveryZone: 'region', targetPct: TARGET })
    for (const it of res.items) {
      expect(Math.abs((it.remains as number) - it.price * TARGET / 100)).toBeLessThanOrEqual(1)
      expect(it.remainsPct).toBe(38)
      expect(linesSum(it) + (it.remains as number)).toBe(it.price)
    }
  })

  it('доли складываются в одном знаменателе: цепочка дала бы 33%, а не 38%', () => {
    const cost = 52_210
    const chained = cost / (1 - 0.38 - 0.12) / (1 - 0.10)
    const chainedLeft = (chained - cost - chained * 0.22) / chained
    expect(chainedLeft).toBeLessThan(0.34)
    const p = priceForTarget({ materials: 32_210, piecework: 20_000, taxPct: 12, salesPct: 10, targetPct: 38 }) as number
    expect((p - cost - p * 0.22) / p).toBeCloseTo(0.38, 4)
  })

  it('на произвольной себестоимости остаток при цене от цели — 38,0% чека', () => {
    for (let materials = 7_000; materials < 200_000; materials += 9_973) {
      const item: FundItemInput = { label: 'x', price: 0, glassCount: 2, materials: [{ key: 'materials', amount: materials }] }
      const probe = orderFunds([item], RATES, { deliveryZone: 'moscow', targetPct: TARGET }).items[0]
      const priced = orderFunds([{ ...item, price: probe.priceForTarget as number }], RATES, { deliveryZone: 'moscow', targetPct: TARGET }).items[0]
      expect(Math.abs((priced.remains as number) - priced.price * TARGET / 100)).toBeLessThanOrEqual(1.5)
      expect(priced.remainsPct).toBe(38)
    }
  })

  it('известный партнёр берёт свои 10% вместо резерва 3%', () => {
    const res = orderFunds(ORDER_0245, RATES, { deliveryZone: 'region', targetPct: TARGET, partner: {} })
    const m4 = res.items[0]
    const partner = fund(m4, 'sales').lines.find(l => l.key === 'partner')?.amount as number
    expect(Math.abs(partner - 89_104 * 0.10)).toBeLessThan(1)
    expect(fund(m4, 'sales').amount).toBe(Math.round(89_104 * 0.17))
    expect(m4.priceForTarget).toBe(Math.round(52_210 * 100 / (100 - 12 - 17 - 38)))
    expect(linesSum(m4) + (m4.remains as number)).toBe(m4.price)
  })
})

describe('нет ставки или себестоимости — missing, а не 0', () => {
  it('без себестоимости материалов остаток и цена от цели не считаются', () => {
    const res = orderFunds([{ label: 'М4', price: 89_104, glassCount: 3, materials: [] }], RATES, { deliveryZone: 'region', targetPct: TARGET })
    const it = res.items[0]
    expect(fund(it, 'materials').amount).toBeNull()
    expect(it.remains).toBeNull()
    expect(it.priceForTarget).toBeNull()
    expect(it.missing).toContain('себестоимость не сохранена')
    expect(fund(it, 'tax').amount).toBe(10_692)
  })

  it('пустая ставка замера — строка null и пропуск назван', () => {
    const rates: OrderFundRates = { ...RATES, measurePerShower: null }
    const it = orderFunds(ORDER_0245.slice(0, 1), rates, { deliveryZone: 'region', targetPct: TARGET }).items[0]
    expect(fund(it, 'piecework').lines.find(l => l.key === 'measure')?.amount).toBeNull()
    expect(fund(it, 'piecework').amount).toBeNull()
    expect(it.remains).toBeNull()
    expect(it.missing).toContain('Замер, ₽ за душевую')
  })

  it('ставка из колонки: пусто, строка, мусор', () => {
    const r = parseOrderFundRates({ ...RATES_JSON, tax_pct: '12', other_pct: null, manager_pct: 'abc' })
    expect(r.taxPct).toBe(12)
    expect(r.otherPct).toBeNull()
    expect(r.managerPct).toBeNull()
    expect(parseOrderFundRates(null).installPerGlass).toBeNull()
    expect(serializeOrderFundRates(RATES)).toEqual(RATES_JSON)
  })
})

describe('делёж доставки и чека', () => {
  it('доставка заказа делится на изделия: каждая доля ±1 ₽, сумма = доставка', () => {
    for (const [total, n] of [[3_500, 3], [5_000, 2], [3_500, 6], [5_000, 7]] as const) {
      const parts = splitDelivery(total, n)
      expect(parts).toHaveLength(n)
      expect(parts.reduce((s, x) => s + x, 0)).toBe(total)
      for (const p of parts) expect(Math.abs(p - total / n)).toBeLessThan(1)
    }
  })

  it('allocate: каждая строка ≈ своя доля и Σ = цель', () => {
    const parts = allocate(262_791, [86_333, 45_046, 97_135])
    expect(parts.reduce((s, x) => s + x, 0)).toBe(262_791)
    const w = 86_333 + 45_046 + 97_135
    parts.forEach((p, i) => expect(Math.abs(p - 262_791 * [86_333, 45_046, 97_135][i] / w)).toBeLessThan(1))
  })
})

describe('сохранённый расчёт → изделия', () => {
  it('«Расчёт» с одной душевой: стекло и фурнитура раздельно, стёкол — по модели', () => {
    const { items, partner } = retailCalcItems({
      product_type: 'build', final_price: 66_542,
      input_data: { perSection: '5500', cart: [{ title: 'М7 Угловая распашная · 1200×1000×2000 мм', cost: 21_860, install: 16_500, total: 66_542 }] },
      cost_breakdown: { glassCost: 11_821, hwCost: 10_039, directCost: 21_860, sections: 3 },
      financial_breakdown: {},
    })
    expect(partner).toBeNull()
    expect(items[0]).toMatchObject({ kind: 'shower', price: 66_542, glassCount: 3 })
    expect(items[0].materials).toEqual([{ key: 'glass', amount: 11_821 }, { key: 'hardware', amount: 10_039 }])
  })

  it('«Расчёт» с зеркалом в корзине: зеркало не раскладывается по ставкам душевой', () => {
    const { items } = retailCalcItems({
      product_type: 'build', final_price: 60_000,
      input_data: { perSection: '6500', cart: [
        { title: 'М2 Прямая распашная · 1040×2000 мм', cost: 20_000, install: 13_000, total: 40_000 },
        { title: 'Зеркало Лофт · Осветлённое 4 мм · 800×1200 мм', cost: 5_000, install: 0, total: 20_000 },
      ] },
      cost_breakdown: { glassCost: 1, hwCost: 1, directCost: 2, sections: 1 },
      financial_breakdown: {},
    })
    expect(items.map(i => i.kind)).toEqual(['shower', 'other'])
    expect(items[0].materials).toEqual([{ key: 'materials', amount: 20_000 }])
    expect(items[0].glassCount).toBe(2)
  })

  it('«Быстрый» без сохранённой себестоимости — материалы пустые, дизайнер = известный партнёр', () => {
    const { items, partner } = retailCalcItems({
      product_type: 'quick', final_price: 190_181,
      input_data: { designer: 10, glass: '', hw: '', cart: [
        { title: 'Душевая перегородка раздвижная', sections: 3, total: 128_667 },
        { title: 'Изделие', sections: 1, total: 36_708 },
      ] },
      cost_breakdown: { directCost: 0 },
      financial_breakdown: { designerMarkupPct: 15 },
    })
    expect(partner).toEqual({ pct: 10 })
    expect(items[0]).toMatchObject({ kind: 'shower', glassCount: 3, materials: [] })
    expect(items[1].kind).toBe('other')
    expect(items.reduce((s, i) => s + i.price, 0)).toBe(190_181)
  })

  it('«Быстрый» нового формата: себестоимость позиции из корзины', () => {
    const { items } = retailCalcItems({
      product_type: 'quick', final_price: 50_000,
      input_data: { cart: [{ title: 'Душевая', sections: 2, total: 50_000, glassCost: 9_000, hwCost: 7_000 }] },
      cost_breakdown: { directCost: 0 }, financial_breakdown: {},
    })
    expect(items[0].materials).toEqual([{ key: 'glass', amount: 9_000 }, { key: 'hardware', amount: 7_000 }])
  })
})

describe('savedProfit — прибыль сохранённого расчёта', () => {
  it('итог − себестоимость корзины − налог с итога; маржа — достигнутая, а не вписанная', () => {
    expect(savedProfit(89_104, 32_210, 12)).toEqual({ profit: 89_104 - 32_210 - 10_692, margin: 51.9 })
  })

  it('себестоимость не известна — null, а не вся цена в прибыль', () => {
    expect(savedProfit(100_072, null, 12)).toBeNull()
    expect(savedProfit(100_072, NaN, 12)).toBeNull()
  })
})
