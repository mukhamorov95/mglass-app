import { describe, it, expect } from 'vitest'
import { standardEconomics, breakdownAt, roundSitePrice, type StandardInputs } from '@/lib/standardLine/economics'
import { calcFinancialModel } from '@/lib/pricing/financialModel'

const base = (): StandardInputs => ({
  costs: {
    glass: { amount: 5000 },
    hardware: { amount: 4000 },
    packaging: { amount: 600 },
    assembly: { amount: 0 },
    delivery: { amount: 1400 },
  },
  shares: { tax: 12, partner: 10, acquiring: 2, reserve: 1 },
  targetMarginPct: 35,
})

describe('юнит-экономика стандартного изделия', () => {
  it('себестоимость до клиента — сумма рублёвых строк, строки сходятся с итогом', () => {
    const e = standardEconomics(base())
    expect(e.costToClient).toBe(11000)
    expect(e.lines.reduce((s, l) => s + l.amount, 0)).toBe(e.costToClient)
    expect(e.missing).toEqual([])
  })

  it('цена по формуле компании = calcFinancialModel с долями от цены как у партнёра', () => {
    const e = standardEconomics(base())
    const fm = calcFinancialModel({ directCost: 11000, marginPercent: 35, taxPercent: 12, partnerPercent: 13 })
    expect(e.formulaPrice).toBe(fm!.finalPrice)
  })

  it('при цене по формуле остаётся маржа минус налог на долю партнёра: m(1−s) − t·s', () => {
    const e = standardEconomics(base())
    // 35·0,87 − 12·0,13 = 30,45 − 1,56 = 28,89 %
    expect(e.atFormula!.remainsPct).toBeCloseTo(28.9, 0)
  })

  it('разбор при цене: цена − себестоимость − доли = остаётся, и это сходится до рубля', () => {
    const b = breakdownAt(30000, 11000, { tax: 12, partner: 10, acquiring: 2, reserve: 1 })
    expect(b.deductions.map(d => d.amount)).toEqual([3600, 3000, 600, 300])
    expect(b.remains).toBe(30000 - 11000 - 7500)
    expect(b.remainsPct).toBe(38.3)
    expect(b.color).toBe('green')
  })

  it('цена безубыточности: при ней не остаётся ничего', () => {
    const e = standardEconomics(base())
    const b = breakdownAt(e.breakevenPrice!, e.costToClient, e.shares)
    expect(Math.abs(b.remains)).toBeLessThanOrEqual(3)
  })

  it('максимальный бонус при цене на сайте держит целевую маржу', () => {
    const i = { ...base(), sitePrice: 30000 }
    const e = standardEconomics(i)
    // 100 − 11000/30000·100 − 12 − 2 − 1 − 35 = 13,3 %
    expect(e.maxPartnerPct).toBe(13.3)
    const at = breakdownAt(30000, 11000, { ...e.shares, partner: e.maxPartnerPct! })
    expect(at.remainsPct).toBeCloseTo(35, 0)
  })

  it('незаполненная строка не прячется: попадает в missing и считается нулём', () => {
    const i = base()
    i.costs.packaging = { amount: null }
    i.shares.acquiring = null
    const e = standardEconomics(i)
    expect(e.missing).toEqual(['Упаковка', 'Эквайринг'])
    expect(e.lines.find(l => l.key === 'packaging')!.filled).toBe(false)
    expect(e.costToClient).toBe(10400)
  })

  it('цена для витрины округляется вверх до сотни', () => {
    expect(roundSitePrice(24801)).toBe(24900)
    expect(roundSitePrice(24900)).toBe(24900)
  })
})
