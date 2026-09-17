import { calcFinancialModel } from '@/lib/pricing/financialModel'
import { contributionColor } from '@/lib/unitEconomics'

// Юнит-экономика стандартного изделия: сколько стоит довезти одно изделие до клиента,
// какая цена получается по формуле компании и сколько остаётся при цене на сайте.
//
// Две группы затрат, и они считаются по-разному:
//  • рубли на изделие (стекло, фурнитура, упаковка, сборка, доставка) — складываются;
//  • доли от цены клиента (налог и расходы, бонус партнёра, эквайринг, резерв на бой) —
//    растут вместе с ценой, поэтому в цену входят делением, а не прибавкой.
// Оклады цеха и аренда — постоянные, в изделие не входят (docs/UNIT_ECONOMICS_ROUTE.md).

export type CostKey = 'glass' | 'hardware' | 'packaging' | 'assembly' | 'delivery'
export type ShareKey = 'tax' | 'partner' | 'acquiring' | 'reserve'

export const COST_LABELS: Record<CostKey, string> = {
  glass: 'Стекло',
  hardware: 'Фурнитура и профиль',
  packaging: 'Упаковка',
  assembly: 'Сборка и комплектация',
  delivery: 'Доставка клиенту',
}

export const SHARE_LABELS: Record<ShareKey, string> = {
  tax: 'Налог и расходы с цены',
  partner: 'Бонус партнёру',
  acquiring: 'Эквайринг',
  reserve: 'Резерв на бой и гарантию',
}

export type CostInput = { amount: number | null; note?: string }
export type StandardInputs = {
  costs: Record<CostKey, CostInput>
  shares: Record<ShareKey, number | null>   // % от цены клиента; null — не заполнено
  targetMarginPct: number
  sitePrice?: number | null
}

export type CostLine = { key: CostKey; label: string; amount: number; filled: boolean; note?: string }
export type Deduction = { key: ShareKey; label: string; pct: number; amount: number }
export type PriceBreakdown = {
  price: number
  cost: number
  deductions: Deduction[]
  remains: number
  remainsPct: number
  color: 'red' | 'amber' | 'green'
}
export type StandardEconomics = {
  lines: CostLine[]
  costToClient: number
  shares: Record<ShareKey, number>
  formulaPrice: number | null     // цена по формуле компании при целевой марже
  breakevenPrice: number | null   // ниже этой цены изделие продаётся в минус
  atFormula: PriceBreakdown | null
  atSite: PriceBreakdown | null
  maxPartnerPct: number | null    // какой бонус выдерживает цена на сайте при целевой марже
  missing: string[]
}

const COST_ORDER: CostKey[] = ['glass', 'hardware', 'packaging', 'assembly', 'delivery']
const SHARE_ORDER: ShareKey[] = ['tax', 'partner', 'acquiring', 'reserve']

const rub = (n: number) => Math.round(n)
const r1 = (n: number) => Math.round(n * 10) / 10

export function breakdownAt(price: number, cost: number, shares: Record<ShareKey, number>): PriceBreakdown {
  const deductions = SHARE_ORDER.map(key => ({
    key, label: SHARE_LABELS[key], pct: shares[key], amount: rub(price * shares[key] / 100),
  }))
  const remains = price - cost - deductions.reduce((s, d) => s + d.amount, 0)
  const remainsPct = price > 0 ? r1(remains / price * 100) : 0
  return { price, cost, deductions, remains, remainsPct, color: contributionColor(remainsPct) }
}

export function standardEconomics(input: StandardInputs): StandardEconomics {
  const missing: string[] = []

  const lines: CostLine[] = COST_ORDER.map(key => {
    const c = input.costs[key]
    const filled = c.amount != null && Number.isFinite(c.amount)
    if (!filled) missing.push(COST_LABELS[key])
    return { key, label: COST_LABELS[key], amount: filled ? rub(c.amount as number) : 0, filled, note: c.note }
  })
  const costToClient = lines.reduce((s, l) => s + l.amount, 0)

  const shares = {} as Record<ShareKey, number>
  for (const key of SHARE_ORDER) {
    const v = input.shares[key]
    if (v == null || !Number.isFinite(v)) { missing.push(SHARE_LABELS[key]); shares[key] = 0 }
    else shares[key] = v
  }

  // Бонус, эквайринг и резерв — доля конечной цены. Так же решено для партнёра в
  // lib/pricing/financialModel.ts: делим, чтобы собственная маржа не таяла.
  const priceShare = shares.partner + shares.acquiring + shares.reserve
  const fm = costToClient > 0
    ? calcFinancialModel({
        directCost: costToClient,
        marginPercent: input.targetMarginPct,
        taxPercent: shares.tax,
        partnerPercent: priceShare,
      })
    : null
  const formulaPrice = fm?.finalPrice ?? null

  // Налог, бонус, эквайринг и резерв удерживаются с одной и той же конечной цены —
  // поэтому доли складываются, а не перемножаются.
  const keep = 1 - (shares.tax + priceShare) / 100
  const breakevenPrice = costToClient > 0 && keep > 0 ? Math.ceil(costToClient / keep) : null

  const site = input.sitePrice != null && input.sitePrice > 0 ? input.sitePrice : null
  const atSite = site != null ? breakdownAt(site, costToClient, shares) : null
  const maxPartnerPct = site != null
    ? Math.max(0, r1(100 - costToClient / site * 100 - shares.tax - shares.acquiring - shares.reserve - input.targetMarginPct))
    : null

  return {
    lines, costToClient, shares, formulaPrice, breakevenPrice,
    atFormula: formulaPrice != null ? breakdownAt(formulaPrice, costToClient, shares) : null,
    atSite, maxPartnerPct, missing,
  }
}

// Цена для витрины: вверх до сотни, чтобы округление не съедало маржу.
export const roundSitePrice = (price: number) => Math.ceil(price / 100) * 100
