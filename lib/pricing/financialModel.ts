// M-Glass shared financial model. Pure functions only — no Supabase, React,
// fetch, or imports from product calculators. Not wired to live UI in this
// step; calculators continue to compute price as before.
//
// CFO decision (recorded here for future readers): partner/designer percent
// uses grossup, not markup:
//   priceWithPartner = basePrice / (1 - partnerPercent / 100)
// Reason: the partner % must be a share of the final customer price, so the
// company's own margin stays whole. Markup (× (1 + p)) would silently dilute
// margin as partner % grows.

export type FinancialModelInput = {
  directCost: number          // ₽, full cost of goods (glass + hardware + works + direct expenses)
  marginPercent: number       // 0..100, target margin
  taxPercent: number          // 0..100, overhead/tax share
  partnerPercent?: number     // 0..<100, partner grossup share of final price
  discountPercent?: number    // 0..<100, applied after partner grossup
}

export type FinancialModelResult = {
  directCost:             number
  basePrice:              number   // directCost / (1 - margin - tax)
  taxAmount:              number   // round(basePrice * tax)
  marginAmount:           number   // round(basePrice * margin)
  partnerAmount:          number   // priceWithPartner - basePrice
  priceWithPartner:       number
  discountAmount:         number
  finalPrice:             number   // round(priceWithPartner * (1 - discount))
  taxOnFinal:             number   // round(finalPrice * tax)
  profit:                 number   // finalPrice - directCost - taxOnFinal
  effectiveMarginPercent: number   // 1 decimal place
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

export function calcFinancialModel(input: FinancialModelInput): FinancialModelResult | null {
  const { directCost, marginPercent, taxPercent } = input
  const partnerPercent  = input.partnerPercent  ?? 0
  const discountPercent = input.discountPercent ?? 0

  // Reject NaN / Infinity / wrong types
  if (
    !isFiniteNumber(directCost) ||
    !isFiniteNumber(marginPercent) ||
    !isFiniteNumber(taxPercent) ||
    !isFiniteNumber(partnerPercent) ||
    !isFiniteNumber(discountPercent)
  ) return null

  // Reject negatives and impossible upper bounds
  if (directCost <= 0)              return null
  if (marginPercent  < 0)           return null
  if (taxPercent     < 0)           return null
  if (partnerPercent < 0)           return null
  if (discountPercent < 0)          return null
  if (partnerPercent  >= 100)       return null
  if (discountPercent >= 100)       return null

  const margin = marginPercent / 100
  const tax    = taxPercent / 100
  const denom  = 1 - margin - tax
  if (denom <= 0) return null

  const basePrice    = directCost / denom
  const taxAmount    = Math.round(basePrice * tax)
  const marginAmount = Math.round(basePrice * margin)

  const partner          = partnerPercent / 100
  const priceWithPartner = partner > 0 ? basePrice / (1 - partner) : basePrice
  const partnerAmount    = Math.round(priceWithPartner - basePrice)

  const discount       = discountPercent / 100
  const finalPrice     = Math.round(priceWithPartner * (1 - discount))
  const discountAmount = Math.round(priceWithPartner - finalPrice)

  const taxOnFinal = Math.round(finalPrice * tax)
  const profit     = finalPrice - directCost - taxOnFinal
  const effectiveMarginPercent =
    finalPrice > 0 ? Math.round((profit / finalPrice) * 1000) / 10 : 0

  return {
    directCost,
    basePrice:        Math.round(basePrice),
    taxAmount,
    marginAmount,
    partnerAmount,
    priceWithPartner: Math.round(priceWithPartner),
    discountAmount,
    finalPrice,
    taxOnFinal,
    profit,
    effectiveMarginPercent,
  }
}
