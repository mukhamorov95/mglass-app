// Two-stage mirror pricing — pure function.
//
// Factory Cost → B2B Price → B2C Client Price.
//
// Stage 1 (production):
//   b2bPrice = factoryCost / (1 - productionTaxPercent/100 - productionMarginPercent/100)
//
// Stage 2 (b2c sells what b2b produced):
//   b2cCost  = roundMoney(b2bPrice)
//   b2cPrice = b2cCost / (1 - b2cTaxPercent/100 - b2cMarginPercent/100)
//
// Services (mount/delivery) are intentionally NOT included here — they
// continue to flow through the live calculator until a dedicated services
// model is wired in.
//
// No Supabase, no React, no app imports. Safe to unit-test in isolation.

export type TwoStagePricingConfig = {
  productionTaxPercent:    number
  productionMarginPercent: number
  b2cTaxPercent:           number
  b2cMarginPercent:        number
}

export type TwoStagePricingInput = {
  factoryCost: number
  config:      TwoStagePricingConfig
}

export type TwoStagePricingWarning = {
  code:     string
  message:  string
  severity: 'info' | 'warning' | 'error'
}

export type TwoStagePricingResult = {
  factoryCost: number
  b2b: {
    price:         number
    taxAmount:     number
    profitAmount:  number
    marginPercent: number
    denominator:   number
  }
  b2c: {
    cost:          number
    price:         number
    taxAmount:     number
    profitAmount:  number
    marginPercent: number
    denominator:   number
  }
  finalClientPrice: number
  warnings:         TwoStagePricingWarning[]
}

const roundMoney   = (value: number) => Math.round(value)
const roundPercent = (value: number) => Math.round(value * 10) / 10

function isPercentValid(p: number): boolean {
  return Number.isFinite(p) && p >= 0 && p < 100
}

export function calculateMirrorTwoStagePricing(
  input: TwoStagePricingInput,
): TwoStagePricingResult | null {
  const { factoryCost, config } = input

  if (!Number.isFinite(factoryCost) || factoryCost <= 0) return null
  if (!isPercentValid(config.productionTaxPercent))      return null
  if (!isPercentValid(config.productionMarginPercent))   return null
  if (!isPercentValid(config.b2cTaxPercent))             return null
  if (!isPercentValid(config.b2cMarginPercent))          return null
  if (config.productionTaxPercent + config.productionMarginPercent >= 100) return null
  if (config.b2cTaxPercent        + config.b2cMarginPercent        >= 100) return null

  const productionDenom    = 1 - config.productionTaxPercent / 100 - config.productionMarginPercent / 100
  const b2bPriceExact      = factoryCost / productionDenom
  const productionTaxRaw   = b2bPriceExact * config.productionTaxPercent    / 100
  const productionProfRaw  = b2bPriceExact * config.productionMarginPercent / 100

  // b2c покупает у b2b по уже округлённой цене — иначе округление каскадно
  // расходится с тем, что увидит менеджер в B2B-строке.
  const b2bPrice           = roundMoney(b2bPriceExact)
  const b2cCost            = b2bPrice
  const b2cDenom           = 1 - config.b2cTaxPercent / 100 - config.b2cMarginPercent / 100
  const b2cPriceExact      = b2cCost / b2cDenom
  const b2cTaxRaw          = b2cPriceExact * config.b2cTaxPercent    / 100
  const b2cProfRaw         = b2cPriceExact * config.b2cMarginPercent / 100
  const b2cPrice           = roundMoney(b2cPriceExact)

  return {
    factoryCost: roundMoney(factoryCost),
    b2b: {
      price:         b2bPrice,
      taxAmount:     roundMoney(productionTaxRaw),
      profitAmount:  roundMoney(productionProfRaw),
      marginPercent: roundPercent(config.productionMarginPercent),
      denominator:   productionDenom,
    },
    b2c: {
      cost:          b2cCost,
      price:         b2cPrice,
      taxAmount:     roundMoney(b2cTaxRaw),
      profitAmount:  roundMoney(b2cProfRaw),
      marginPercent: roundPercent(config.b2cMarginPercent),
      denominator:   b2cDenom,
    },
    finalClientPrice: b2cPrice,
    warnings: [],
  }
}
