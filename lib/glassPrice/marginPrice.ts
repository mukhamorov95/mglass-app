// Процент под продажной ценой в справочнике стекла и цена по этому проценту — одна формула
// в обе стороны: маржа = (цена − себестоимость без НДС − опекс от цены) / цена.

export type NetCostInput = {
  cost: number
  wastePct: number
  purchaseVatPct: number
  temperingPerM2?: number
  temperingVatPct?: number
}

// Себестоимость 1 м² без НДС к зачёту: закупка с расходом, у стекла — плюс закалка с тем же расходом
export function saleNetCost({ cost, wastePct, purchaseVatPct, temperingPerM2 = 0, temperingVatPct = 0 }: NetCostInput): number {
  const eff = cost * (1 + wastePct / 100)
  let net = eff - eff * purchaseVatPct / (100 + purchaseVatPct)
  if (temperingPerM2 > 0) {
    const temp = temperingPerM2 * (1 + wastePct / 100)
    net += temp - temp * temperingVatPct / (100 + temperingVatPct)
  }
  return net
}

export function marginOf(price: number, netCost: number, opexPct: number): number {
  if (!(price > 0)) return 0
  const opex = Math.round(price * opexPct / 100)
  return (price - netCost - opex) / price * 100
}

export const tenth = (x: number) => Math.round(x * 10) / 10

// Наименьшая цена в целых рублях, при которой процент под ней — в показанной точности 0,1 —
// не ниже заданного. null — процент недостижим: опекс и маржа вместе съедают всю цену.
export function priceForMargin(netCost: number, opexPct: number, marginPct: number): number | null {
  if (!(netCost > 0) || !Number.isFinite(marginPct)) return null
  const denom = 1 - (opexPct + marginPct) / 100
  if (denom <= 0) return null
  const want = tenth(marginPct)
  const shown = (p: number) => tenth(marginOf(p, netCost, opexPct))
  let price = Math.max(1, Math.ceil(netCost / denom - 1e-9))
  // опекс округляется до рубля, а показ — до 0,1: доводим по рублю в обе стороны
  for (let i = 0; i < 50 && shown(price) < want; i++) price++
  for (let i = 0; i < 50 && price > 1 && shown(price - 1) >= want; i++) price--
  return price
}

// «45», «45,5», «45.5 %» → 45.5; пусто или мусор — null
export function parsePct(raw: string): number | null {
  const s = raw.replace(',', '.').replace(/[%\s]/g, '')
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null
  return Number(s)
}
